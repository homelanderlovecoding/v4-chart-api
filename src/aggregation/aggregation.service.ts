import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { ethers } from 'ethers';
import { TokenMinute, TokenMinuteDocument, RecordStatus as MinuteStatus } from './schemas/token-minute.schema';
import { TokenHour, TokenHourDocument } from './schemas/token-hour.schema';
import { TokenDay, TokenDayDocument } from './schemas/token-day.schema';
import { Token, TokenDocument } from './schemas/token.schema';
import { Pool, PoolDocument } from '../swap-events/schemas/pool.schema';
import { ConfigService } from '../config/config.service';
import { SwapEvent, SwapEventDocument } from '../swap-events/schemas/swap-event.schema';

// ERC20 ABI for decimals, symbol, and name
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

export const ZERO_BI = BigInt(0)
export const ONE_BI = BigInt(1)
export const ZERO_BD = 0
export const ONE_BD = 1
export const Q96 = BigInt(2) ** BigInt(96)

export enum TimeInterval {
  MINUTE = 'minute',
  HOUR = 'hour',
  DAY = 'day',
}

export enum RecordStatus {
  CURRENT = 'current',
  FINALIZED = 'finalized',
}

@Injectable()
export class AggregationService implements OnModuleInit {
  private readonly logger = new Logger(AggregationService.name);
  private provider: ethers.JsonRpcProvider;

  constructor(
    @InjectModel(TokenMinute.name)
    private tokenMinuteModel: Model<TokenMinuteDocument>,
    @InjectModel(TokenHour.name)
    private tokenHourModel: Model<TokenHourDocument>,
    @InjectModel(TokenDay.name)
    private tokenDayModel: Model<TokenDayDocument>,
    @InjectModel(Token.name)
    private tokenModel: Model<TokenDocument>,
    @InjectModel(Pool.name)
    private poolModel: Model<PoolDocument>,
    private eventEmitter: EventEmitter2,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    this.logger.log('AggregationService initialized - listening for swap events');
    await this.initializeProvider();
  }

  private async initializeProvider() {
    try {
      const rpcUrl = this.configService.ethRpcUrl;
      // Use HTTP provider for read-only operations
      const httpUrl = rpcUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      this.provider = new ethers.JsonRpcProvider(httpUrl);
      this.logger.log('Aggregation service provider initialized');
    } catch (error) {
      this.logger.error('Failed to initialize provider for aggregation service', error);
      throw error;
    }
  }

  /**
   * Fetch token metadata from contract
   */
  private async fetchTokenMetadata(tokenAddress: string): Promise<{
    decimals: number;
    symbol: string;
    name: string;
  }> {
    try {
      if (tokenAddress === '0x0000000000000000000000000000000000000000' || tokenAddress === this.configService.wrappedNativeAddress) {
        return {
          decimals: 18,
          symbol: 'ETH',
          name: 'Ethereum',
        };
      }

      console.log('fetching token metadata for', tokenAddress);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);

      const [decimals, symbol, name] = await Promise.all([
        contract.decimals(),
        contract.symbol().catch(() => 'UNKNOWN'),
        contract.name().catch(() => 'Unknown Token'),
      ]);

      this.logger.log(`Fetched metadata for ${tokenAddress}: ${symbol} (${decimals} decimals)`);

      return {
        decimals: Number(decimals),
        symbol,
        name,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch metadata for ${tokenAddress}, using defaults`, error);
      // Return defaults if contract call fails
      return {
        decimals: 18,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
      };
    }
  }

  /**
   * Get native (wrapped BTC/ETH) price in USD from stablecoin-wrapped native pool
   */
  private async getNativePriceInUSD(): Promise<number> {
    const poolId = this.configService.stablecoinWrappedNativePoolId;
    const stablecoinIsToken0 = this.configService.stablecoinIsToken0;

    if (!poolId) {
      this.logger.warn('Stablecoin-wrapped native pool ID not configured');
      return ZERO_BD;
    }

    const pool = await this.poolModel.findOne({ poolId });
    if (!pool) {
      this.logger.warn(`Stablecoin-wrapped native pool not found: ${poolId}`);
      return ZERO_BD;
    }

    // token0Price is price of token0 in terms of token1
    // token1Price is price of token1 in terms of token0
    // If stablecoin is token0, then token0Price gives us native price in USD
    // If stablecoin is token1, then token1Price gives us native price in USD
    const nativePriceUSD = stablecoinIsToken0
      ? parseFloat(pool.token0Price)
      : parseFloat(pool.token1Price);

    console.log('nativePriceUSD', nativePriceUSD);

    return nativePriceUSD || ZERO_BD;
  }

  /**
   * Calculate absolute value of amount
   */
  private abs(amount: string): bigint {
    const value = BigInt(amount);
    return value < 0 ? -value : value;
  }

  /**
   * Convert raw token amount to decimal value using token decimals
   */
  private toDecimal(amount: string, decimals: number): number {
    const value = BigInt(amount);
    const divisor = BigInt(10) ** BigInt(decimals);
    // Convert to float by dividing and using remainder for precision
    const whole = Number(value / divisor);
    const remainder = Number(value % divisor);
    return whole + remainder / Number(divisor);
  }

  /**
   * Round timestamp to period start
   */
  private roundTimestamp(date: Date, interval: TimeInterval): Date {
    const timestamp = new Date(date);

    switch (interval) {
      case TimeInterval.MINUTE:
        timestamp.setSeconds(0, 0);
        break;
      case TimeInterval.HOUR:
        timestamp.setMinutes(0, 0, 0);
        break;
      case TimeInterval.DAY:
        timestamp.setHours(0, 0, 0, 0);
        break;
    }

    return timestamp;
  }

  /**
   * Get model by interval
   */
  private getModelByInterval(interval: TimeInterval) {
    switch (interval) {
      case TimeInterval.MINUTE:
        return this.tokenMinuteModel;
      case TimeInterval.HOUR:
        return this.tokenHourModel;
      case TimeInterval.DAY:
        return this.tokenDayModel;
    }
  }

  /**
   * Process swap event and update aggregation data
   * Called directly by SwapEventsService
   */
  async processSwapEvent(swap: SwapEventDocument) {
    try {
      // Update current records for both tokens
      // await Promise.all([
      //   this.updateCurrentRecord(swap, swap.token0Address, true),
      //   this.updateCurrentRecord(swap, swap.token1Address, false),
      // ]);

      await this.updateCurrentRecord(swap, swap.token0Address, true);
      await this.updateCurrentRecord(swap, swap.token1Address, false);
    } catch (error) {
      this.logger.error('Error handling swap event for aggregation', error);
    }
  }

  /**
   * Update token whitelist with a new pool
   * Called directly by SwapEventsService
   */
  async processTokenWhitelistUpdate(data: { tokenAddress: string; poolId: string }) {
    try {
      const { tokenAddress, poolId } = data;

      // Update token's whitelist pools (create with defaults if doesn't exist)
      await this.tokenModel.updateOne(
        { address: tokenAddress },
        {
          $addToSet: { whitelistPools: poolId },
          $setOnInsert: {
            address: tokenAddress,
            decimals: 18, // default, will be updated on first swap
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
            volume: '0',
            volumeUSD: '0',
            untrackedVolumeUSD: '0',
            feesUSD: '0',
            txCount: 0,
            totalValueLocked: '0',
            totalValueLockedUSD: '0',
            derivedBTC: '0',
          }
        },
        { upsert: true },
      );

      this.logger.log(`Updated whitelist for token ${tokenAddress} with pool ${poolId}`);
    } catch (error) {
      this.logger.error('Error updating token whitelist', error);
    }
  }

  /**
   * Update current period records for a token when a swap occurs
   */
  private async updateCurrentRecord(
    swap: SwapEventDocument,
    tokenAddress: string,
    isToken0: boolean,
  ) {
    // Get or create token
    let token = await this.tokenModel.findOne({ address: tokenAddress });
    if (!token) {
      // Fetch token metadata from contract
      const metadata = await this.fetchTokenMetadata(tokenAddress);

      // Try to create token (might already exist from whitelist update)
      try {
        token = await this.tokenModel.create({
          address: tokenAddress,
          decimals: metadata.decimals,
          symbol: metadata.symbol,
          name: metadata.name,
          volume: '0',
          volumeUSD: '0',
          untrackedVolumeUSD: '0',
          feesUSD: '0',
          totalValueLocked: '0',
          totalValueLockedUSD: '0',
          derivedBTC: '0',
          txCount: 0,
          whitelistPools: [],
        });
      } catch (error) {
        // Token already exists (created by whitelist update), fetch it
        if (error.code === 11000) {
          token = await this.tokenModel.findOne({ address: tokenAddress });
        } else {
          throw error;
        }
      }
    }

    // Update metadata if token has default/unknown values
    if (token && token.symbol === 'UNKNOWN') {
      const metadata = await this.fetchTokenMetadata(tokenAddress);
      await this.tokenModel.updateOne(
        { address: tokenAddress },
        {
          $set: {
            decimals: metadata.decimals,
            symbol: metadata.symbol,
            name: metadata.name,
          },
        },
      );
      // Update the local token object
      token.decimals = metadata.decimals;
      token.symbol = metadata.symbol;
      token.name = metadata.name;
    }

    // Get amount for this token
    const amount = isToken0 ? swap.amount0 : swap.amount1;
    const absAmountBigInt = this.abs(amount);

    // Calculate USD values
    const amountUSD = 0;

    // Calculate fees
    const feePercentage = swap.fee / 10000;
    const feesUSD = amountUSD * feePercentage;

    // Calculate TVL delta
    const newTVL = 0n;
    const newTVLUSD = 0;

    // derived BTC
    const derivedBTC = await this.findNativePerToken(token, this.configService.wrappedNativeAddress, this.configService.stablecoinAddresses, ZERO_BI);

    // Update cumulative token values
    await this.tokenModel.updateOne(
      { address: tokenAddress },
      {
        $inc: {
          txCount: 1,
        },
        $set: {
          volume: (BigInt(token.volume) + absAmountBigInt).toString(),
          volumeUSD: (parseFloat(token.volumeUSD) + amountUSD).toFixed(6),
          untrackedVolumeUSD: (parseFloat(token.untrackedVolumeUSD) + amountUSD).toFixed(6),
          feesUSD: (parseFloat(token.feesUSD) + feesUSD).toFixed(6),
          // totalValueLocked: newTVL.toString(),
          // totalValueLockedUSD: newTVLUSD.toFixed(6),
          derivedBTC: derivedBTC.toFixed(18),
        },
      },
    );

    // Update minute, hour, and day records
    await Promise.all([
      this.updateOrCreateCurrentRecord(
        tokenAddress,
        TimeInterval.MINUTE,
        swap.blockTimestamp,
        absAmountBigInt,
        amountUSD,
        feesUSD,
        derivedBTC,
        newTVL,
        newTVLUSD,
      ),
      this.updateOrCreateCurrentRecord(
        tokenAddress,
        TimeInterval.HOUR,
        swap.blockTimestamp,
        absAmountBigInt,
        amountUSD,
        feesUSD,
        derivedBTC,
        newTVL,
        newTVLUSD,
      ),
      this.updateOrCreateCurrentRecord(
        tokenAddress,
        TimeInterval.DAY,
        swap.blockTimestamp,
        absAmountBigInt,
        amountUSD,
        feesUSD,
        derivedBTC,
        newTVL,
        newTVLUSD,
      ),
    ]);
  }

  /**
   * Update or create current record for a specific interval
   */
  private async updateOrCreateCurrentRecord(
    tokenAddress: string,
    interval: TimeInterval,
    timestamp: Date,
    volumeDelta: bigint,
    volumeUSDDelta: number,
    feesDelta: number,
    currentPrice: number,
    totalValueLocked: bigint,
    totalValueLockedUSD: number,
  ) {
    const date = this.roundTimestamp(timestamp, interval);
    const model = this.getModelByInterval(interval) as Model<any>;

    // Find current record or create new one
    const existingRecord = await model.findOne({
      tokenAddress,
      date,
      status: RecordStatus.CURRENT,
    });

    if (existingRecord) {
      // Update existing record
      const newVolume = BigInt(existingRecord.volume) + volumeDelta;
      const newVolumeUSD = parseFloat(existingRecord.volumeUSD) + volumeUSDDelta;
      const newUntrackedVolumeUSD = parseFloat(existingRecord.untrackedVolumeUSD) + volumeUSDDelta;
      const newFeesUSD = parseFloat(existingRecord.feesUSD) + feesDelta;
      const newTxCount = existingRecord.txCount + 1;

      // Update OHLC
      const open = existingRecord.open !== '0' ? parseFloat(existingRecord.open) : currentPrice;
      const high = Math.max(parseFloat(existingRecord.high), currentPrice);
      const low = existingRecord.low !== '0'
        ? Math.min(parseFloat(existingRecord.low), currentPrice)
        : currentPrice;
      const close = currentPrice;

      await model.updateOne(
        { _id: existingRecord._id },
        {
          $set: {
            volume: newVolume.toString(),
            volumeUSD: newVolumeUSD.toFixed(6),
            untrackedVolumeUSD: newUntrackedVolumeUSD.toFixed(6),
            feesUSD: newFeesUSD.toFixed(6),
            totalValueLocked: totalValueLocked.toString(),
            totalValueLockedUSD: totalValueLockedUSD.toFixed(6),
            priceUSD: currentPrice.toFixed(6),
            open: open.toFixed(6),
            high: high.toFixed(6),
            low: low.toFixed(6),
            close: close.toFixed(6),
            txCount: newTxCount,
          },
        },
      );
    } else {
      // Create new current record
      await model.create({
        tokenAddress,
        date,
        status: RecordStatus.CURRENT,
        volume: volumeDelta.toString(),
        volumeUSD: volumeUSDDelta.toFixed(6),
        untrackedVolumeUSD: volumeUSDDelta.toFixed(6),
        feesUSD: feesDelta.toFixed(6),
        totalValueLocked: totalValueLocked.toString(),
        totalValueLockedUSD: totalValueLockedUSD.toFixed(6),
        priceUSD: currentPrice.toFixed(6),
        open: currentPrice.toFixed(6),
        high: currentPrice.toFixed(6),
        low: currentPrice.toFixed(6),
        close: currentPrice.toFixed(6),
        txCount: 1,
      });
    }
  }

  /**
   * Finalize current minute records and create new ones
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async finalizeMinuteRecords() {
    await this.finalizeRecords(TimeInterval.MINUTE);
  }

  /**
   * Finalize current hour records and create new ones
   */
  @Cron(CronExpression.EVERY_HOUR)
  async finalizeHourRecords() {
    await this.finalizeRecords(TimeInterval.HOUR);
  }

  /**
   * Finalize current day records and create new ones
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async finalizeDayRecords() {
    await this.finalizeRecords(TimeInterval.DAY);
  }

  /**
   * Finalize all current records for an interval
   */
  private async finalizeRecords(interval: TimeInterval) {
    try {
      const model = this.getModelByInterval(interval) as Model<any>;

      // Get the timestamp for the period that just ended
      const now = new Date();
      const previousPeriod = this.getPreviousPeriod(now, interval);
      const previousPeriodDate = this.roundTimestamp(previousPeriod, interval);

      // Get all current records for the previous period before finalizing
      const recordsToFinalize = await model.find({
        date: previousPeriodDate,
        status: RecordStatus.CURRENT,
      }).exec();

      // Finalize all current records for the previous period
      const result = await model.updateMany(
        {
          date: previousPeriodDate,
          status: RecordStatus.CURRENT,
        },
        {
          $set: { status: RecordStatus.FINALIZED },
        },
      );

      this.logger.log(
        `Finalized ${result.modifiedCount} ${interval} records for ${previousPeriodDate.toISOString()}`,
      );

      // Emit WebSocket events for each finalized candle
      for (const record of recordsToFinalize) {
        this.eventEmitter.emit('candle.finalized', {
          interval,
          tokenAddress: record.tokenAddress,
          date: record.date,
          volume: record.volume,
          volumeUSD: record.volumeUSD,
          untrackedVolumeUSD: record.untrackedVolumeUSD,
          totalValueLocked: record.totalValueLocked,
          totalValueLockedUSD: record.totalValueLockedUSD,
          priceUSD: record.priceUSD,
          feesUSD: record.feesUSD,
          open: record.open,
          high: record.high,
          low: record.low,
          close: record.close,
          txCount: record.txCount,
        });
      }
    } catch (error) {
      this.logger.error(`Error finalizing ${interval} records`, error);
    }
  }

  /**
   * Get the previous period timestamp
   */
  private getPreviousPeriod(date: Date, interval: TimeInterval): Date {
    const previous = new Date(date);

    switch (interval) {
      case TimeInterval.MINUTE:
        previous.setMinutes(previous.getMinutes() - 1);
        break;
      case TimeInterval.HOUR:
        previous.setHours(previous.getHours() - 1);
        break;
      case TimeInterval.DAY:
        previous.setDate(previous.getDate() - 1);
        break;
    }

    return previous;
  }

  /**
   * Get token data for a specific interval
   */
  async getTokenData(
    tokenAddress: string,
    interval: TimeInterval,
    startTime?: Date,
    endTime?: Date,
    limit = 100,
  ): Promise<(TokenMinute | TokenHour | TokenDay)[]> {
    const query: any = { tokenAddress };

    if (startTime || endTime) {
      query.date = {};
      if (startTime) query.date.$gte = startTime;
      if (endTime) query.date.$lte = endTime;
    }

    const model = this.getModelByInterval(interval) as Model<any>;

    return model
      .find(query)
      .sort({ date: -1 })
      .limit(limit)
      .exec();
  }

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
private async findNativePerToken(
  token: Token,
  wrappedNativeAddress: string,
  stablecoinAddresses: string[],
  minimumNativeLocked: bigint,
): Promise<number> {
  console.log("--------------------------------");
  console.log('token.address', token.address);
  if (token.address == wrappedNativeAddress || token.address == '0x0000000000000000000000000000000000000000') {
    return 1
  }
  const whiteList = token.whitelistPools
  // for now just take USD from pool with greatest TVL
  // need to update this to actually detect best rate based on liquidity distribution
  let largestLiquidityBTC = ZERO_BD
  let priceSoFar = ZERO_BD

  // hardcoded fix for incorrect rates
  // if whitelist includes token - get the safe price
  if (stablecoinAddresses.includes(token.address)) {
    const btcPrice = await this.getNativePriceInUSD()
    if (!btcPrice) {
      return 1
    }
    priceSoFar = 1 / btcPrice
  } else {
    console.log('whitelist', whiteList);

    for (let i = 0; i < whiteList.length; ++i) {
      const poolAddress = whiteList[i]
      const pool = await this.poolModel.findOne({ poolId: poolAddress })

      if (pool) {
        const poolLiquidity = BigInt(pool.liquidity || '0');
        if (poolLiquidity > BigInt(0)) {
          if (pool.currency0 == token.address) {
            // whitelist token is token1
            const token1 = await this.tokenModel.findOne({ address: pool.currency1 })
            // get the derived ETH in pool
            if (token1) {
              // Use liquidity as a proxy for pool size
              const tvlDecimal = this.toDecimal(pool.totalValueLockedToken1, token1.decimals);
              const btcLocked = tvlDecimal * parseFloat(token1.derivedBTC)
              console.log('token1', token1);
              console.log('pool.totalValueLockedToken1', tvlDecimal);
              console.log('token1.derivedBTC', token1.derivedBTC);
              console.log('btcLocked', btcLocked);

              if (btcLocked > largestLiquidityBTC && btcLocked > Number(minimumNativeLocked)) {
                largestLiquidityBTC = btcLocked
                // token1 per our token * Eth per token1
                priceSoFar = parseFloat(pool.token1Price) * parseFloat(token1.derivedBTC)
              }
            }
          }
          if (pool.currency1 == token.address) {
            const token0 = await this.tokenModel.findOne({ address: pool.currency0 })
            // get the derived ETH in pool
            if (token0) {
              // Use liquidity as a proxy for pool size
              const tvlDecimal = this.toDecimal(pool.totalValueLockedToken0, token0.decimals);
              const btcLocked = tvlDecimal * parseFloat(token0.derivedBTC)
              console.log('token0', token0);
              console.log('pool.totalValueLockedToken0', tvlDecimal);
              console.log('token0.derivedBTC', token0.derivedBTC);
              console.log('btcLocked', btcLocked);
              if (btcLocked > largestLiquidityBTC && btcLocked > Number(minimumNativeLocked)) {
                largestLiquidityBTC = btcLocked
                // token0 per our token * ETH per token0
                priceSoFar = parseFloat(pool.token0Price) * parseFloat(token0.derivedBTC)
              }
            }
          }
        }
      }
    }
  }
  return priceSoFar
}
}
