import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ethers } from 'ethers';
import { SwapEvent, SwapEventDocument } from './schemas/swap-event.schema';
import { SyncState, SyncStateDocument } from './schemas/sync-state.schema';
import { Pool, PoolDocument } from './schemas/pool.schema';
import { Token, TokenDocument } from '../aggregation/schemas/token.schema';
import { ConfigService } from '../config/config.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AggregationService } from '../aggregation/aggregation.service';
import { TickMath } from '../liquidityMath/tickMath';
import { getAmount0, getAmount1 } from 'src/liquidityMath/liquidityAmounts';

// Uniswap V4 Pool Manager ABI - Initialize, Swap, and ModifyLiquidity event signatures
const POOL_MANAGER_ABI = [
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
  'event Swap(bytes32 indexed poolId, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
];

/**
 * Helper function to calculate 10^decimals
 */
function exponentToBigDecimal(decimals: number): number {
  return Math.pow(10, decimals);
}

/**
 * Safe division helper
 */
function safeDiv(numerator: number, denominator: number): number {
  return denominator !== 0 ? numerator / denominator : 0;
}

/**
 * Convert sqrtPriceX96 to token prices with decimal adjustment
 * @param sqrtPriceX96 - square root price in X96 format
 * @param token0Decimals - decimals for token0
 * @param token1Decimals - decimals for token1
 * @returns token0Price (price of token0 in terms of token1) and token1Price (price of token1 in terms of token0)
 */
function sqrtPriceX96ToTokenPrices(
  sqrtPriceX96: string,
  token0Decimals: number,
  token1Decimals: number,
): {
  token0Price: string;
  token1Price: string;
} {
  const Q192 = BigInt(2) ** BigInt(192);
  const sqrtPrice = BigInt(sqrtPriceX96);

  // num = sqrtPriceX96 * sqrtPriceX96
  const num = sqrtPrice * sqrtPrice;

  // Convert to number for decimal operations
  const numDecimal = Number(num);
  const denomDecimal = Number(Q192);

  // price1 = (num / Q192) * (10^token0Decimals) / (10^token1Decimals)
  // This gives us the price of token1 in terms of token0
  const price1 = (numDecimal / denomDecimal) *
                 exponentToBigDecimal(token0Decimals) /
                 exponentToBigDecimal(token1Decimals);

  // price0 = 1 / price1
  // This gives us the price of token0 in terms of token1
  const price0 = safeDiv(1, price1);

  return {
    token0Price: price0.toString(),
    token1Price: price1.toString(),
  };
}

// ERC20 ABI for decimals
const ERC20_ABI = ['function decimals() view returns (uint8)'];

@Injectable()
export class SwapEventsService implements OnModuleInit {
  private readonly logger = new Logger(SwapEventsService.name);
  private provider: ethers.WebSocketProvider;
  private contract: ethers.Contract;
  private isSyncing = false;
  private tokenDecimalsCache: Map<string, number> = new Map();

  constructor(
    @InjectModel(SwapEvent.name)
    private swapEventModel: Model<SwapEventDocument>,
    @InjectModel(SyncState.name)
    private syncStateModel: Model<SyncStateDocument>,
    @InjectModel(Pool.name)
    private poolModel: Model<PoolDocument>,
    @InjectModel(Token.name)
    private tokenModel: Model<TokenDocument>,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => AggregationService))
    private aggregationService: AggregationService,
  ) {}

  async onModuleInit() {
    await this.initializeProvider();
    // Run sync in background to not block other services from initializing
    this.syncHistoricalEvents().catch(err =>
      this.logger.error('Error in historical sync', err)
    );
    await this.startListening();
  }

  private async initializeProvider() {
    try {
      const rpcUrl = this.configService.ethRpcUrl;

      // Convert HTTP to WebSocket URL if needed
      const wsUrl = rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');

      this.provider = new ethers.WebSocketProvider(wsUrl);

      const poolManagerAddress = this.configService.uniswapV4PoolManagerAddress;
      this.contract = new ethers.Contract(
        poolManagerAddress,
        POOL_MANAGER_ABI,
        this.provider,
      );

      this.logger.log('Ethereum provider initialized');
    } catch (error) {
      this.logger.error('Failed to initialize provider', error);
      throw error;
    }
  }

  async syncHistoricalEvents() {
    this.isSyncing = true;
    const poolManagerAddress = this.configService.uniswapV4PoolManagerAddress;

    try {
      // Get or create sync state
      let syncState = await this.syncStateModel.findOne({ poolManagerAddress });

      const currentBlock = await this.provider.getBlockNumber();
      const startingBlock = this.configService.startingBlock;

      if (!syncState) {
        // First time sync - create new sync state
        syncState = new this.syncStateModel({
          poolManagerAddress,
          lastSyncedBlock: startingBlock - 1,
          currentBlock,
          isInitialSyncComplete: false,
        });
        await syncState.save();
        this.logger.log(`Starting initial sync from block ${startingBlock}`);
      } else if (syncState.isInitialSyncComplete) {
        // Resume from last synced block
        this.logger.log(
          `Resuming sync from block ${syncState.lastSyncedBlock + 1} to ${currentBlock}`,
        );
      } else {
        this.logger.log(
          `Continuing incomplete sync from block ${syncState.lastSyncedBlock + 1}`,
        );
      }

      // Sync in batches
      const batchSize = this.configService.syncBatchSize;
      let fromBlock = syncState.lastSyncedBlock + 1;

      while (fromBlock <= currentBlock) {
        const toBlock = Math.min(fromBlock + batchSize - 1, currentBlock);

        this.logger.log(
          `Syncing blocks ${fromBlock} to ${toBlock} (${Math.round(
            ((toBlock - startingBlock) / (currentBlock - startingBlock)) * 100,
          )}% complete)`,
        );

        await this.syncBatch(fromBlock, toBlock);

        // Update sync state
        await this.syncStateModel.updateOne(
          { poolManagerAddress },
          {
            lastSyncedBlock: toBlock,
            currentBlock,
            lastSyncedAt: new Date(),
            isInitialSyncComplete: toBlock >= currentBlock,
          },
        );

        fromBlock = toBlock + 1;
      }

      this.logger.log('Historical sync complete! Ready to listen for new events.');
      this.isSyncing = false;
    } catch (error) {
      this.logger.error('Error during historical sync', error);
      this.isSyncing = false;
      throw error;
    }
  }

  private async syncBatch(fromBlock: number, toBlock: number) {
    try {
      const poolManagerAddress = this.configService.uniswapV4PoolManagerAddress;

      // Get event signatures for all three event types
      const initializeSignature = ethers.id('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)');
      const swapSignature = ethers.id('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)');
      const modifyLiquiditySignature = ethers.id('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)');

      // Fetch all logs with OR filter on all event signatures
      const logs = await this.provider.getLogs({
        address: poolManagerAddress,
        topics: [
          [initializeSignature, swapSignature, modifyLiquiditySignature], // OR filter for all events
        ],
        fromBlock,
        toBlock,
      });

      this.logger.log(`Found ${logs.length} events in blocks ${fromBlock}-${toBlock}`);
      // Process logs sequentially in the order they occurred
      for (const log of logs) {
        try {
          // Parse the log
          const parsedLog = this.contract.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });

          if (!parsedLog) {
            this.logger.warn('Failed to parse log in batch sync');
            continue;
          }

          const signature = log.topics[0];

          if (signature === initializeSignature) {
            // Create EventLog-like object for handleInitializeEvent
            const eventLog = new ethers.EventLog(
              log,
              this.contract.interface,
              parsedLog.fragment,
            );

            // Call the shared handleInitializeEvent function
            await this.handleInitializeEvent(eventLog);
          } else if (signature === swapSignature) {
            const [poolId, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee] = parsedLog.args;

            // Create EventLog-like object for handleSwapEvent
            const eventLog = new ethers.EventLog(
              log,
              this.contract.interface,
              parsedLog.fragment,
            );

            // Call the shared handleSwapEvent function
            await this.handleSwapEvent({
              poolId,
              sender,
              amount0,
              amount1,
              sqrtPriceX96,
              liquidity,
              tick: Number(tick),
              fee: Number(fee),
              event: eventLog,
            });
          } else if (signature === modifyLiquiditySignature) {
            const [poolId, sender, tickLower, tickUpper, liquidityDelta, salt] = parsedLog.args;

            // Create EventLog-like object for handleModifyLiquidityEvent
            const eventLog = new ethers.EventLog(
              log,
              this.contract.interface,
              parsedLog.fragment,
            );

            // Call the shared handleModifyLiquidityEvent function
            await this.handleModifyLiquidityEvent({
              poolId,
              sender,
              tickLower: Number(tickLower),
              tickUpper: Number(tickUpper),
              liquidityDelta,
              salt,
              event: eventLog,
            });
          }
        } catch (error) {
          if (error.code === 11000) {
            // Duplicate - skip
            continue;
          } else {
            this.logger.error(`Error processing event in batch`, error);
            throw error;
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error syncing batch ${fromBlock}-${toBlock}`, error);
      throw error;
    }
  }

  async startListening() {
    this.logger.log('Starting to listen for real-time events (Initialize, Swap, ModifyLiquidity)...');

    const poolManagerAddress = this.configService.uniswapV4PoolManagerAddress;

    // Get event signatures (topic0 hashes)
    const initializeSignature = ethers.id('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)');
    const swapSignature = ethers.id('Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)');
    const modifyLiquiditySignature = ethers.id('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)');

    // Queue to maintain sequential processing and avoid race conditions
    const eventQueue: Array<{ log: ethers.Log; signature: string }> = [];
    let isProcessing = false;

    const processQueue = async () => {
      if (isProcessing || eventQueue.length === 0) {
        return;
      }

      isProcessing = true;

      while (eventQueue.length > 0) {
        const { log, signature } = eventQueue.shift()!;

        try {
          // Skip if we're still syncing to avoid duplicates
          if (this.isSyncing) {
            continue;
          }

          // Parse the log using the contract interface
          const parsedLog = this.contract.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });

          if (!parsedLog) {
            this.logger.warn('Failed to parse log');
            continue;
          }

          // Create EventLog with proper parameters (log, interface, fragment)
          const eventLog = new ethers.EventLog(
            log,
            this.contract.interface,
            parsedLog.fragment,
          );

          // Process based on event type
          if (signature === initializeSignature) {
            await this.handleInitializeEvent(eventLog);
          } else if (signature === swapSignature) {
            await this.handleSwapEventFromLog(eventLog);
          } else if (signature === modifyLiquiditySignature) {
            await this.handleModifyLiquidityEventFromLog(eventLog);
          }
        } catch (error) {
          this.logger.error(`Error processing event from queue: ${signature}`, error);
        }
      }

      isProcessing = false;
    };

    // Subscribe to logs with OR filter on multiple event signatures
    const filter = {
      address: poolManagerAddress,
      topics: [
        [initializeSignature, swapSignature, modifyLiquiditySignature], // OR filter
      ],
    };

    this.provider.on(filter, (log: ethers.Log) => {
      // Add to queue and trigger processing
      const signature = log.topics[0];
      eventQueue.push({ log, signature });

      // Trigger queue processing (non-blocking)
      processQueue().catch((error) => {
        this.logger.error('Error in queue processing', error);
      });
    });

    this.provider.on('error', (error) => {
      this.logger.error('WebSocket error', error);
    });

    this.logger.log('Event subscription active with sequential processing queue');
  }

  private async handleInitializeEvent(event: ethers.EventLog) {
    const [id, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick] = event.args;

    try {
      const block = await this.provider.getBlock(event.blockNumber);

      // Fetch token decimals
      const [token0Decimals, token1Decimals] = await Promise.all([
        this.fetchTokenDecimals(currency0),
        this.fetchTokenDecimals(currency1),
      ]);

      // Calculate token prices from sqrtPriceX96 with decimal adjustment
      const { token0Price, token1Price } = sqrtPriceX96ToTokenPrices(
        sqrtPriceX96.toString(),
        token0Decimals,
        token1Decimals,
      );

      console.log('token0Price', token0Price);
      console.log('token1Price', token1Price);
      
      await this.poolModel.create({
        poolId: id,
        currency0,
        currency1,
        fee: Number(fee),
        tickSpacing: Number(tickSpacing),
        hooks,
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick: Number(tick),
        blockNumber: event.blockNumber,
        blockTimestamp: new Date(block.timestamp * 1000),
        transactionHash: event.transactionHash,
        token0Price,
        token1Price,
      });

      this.logger.log(`New pool initialized: ${id} (${currency0}/${currency1})`);

      // Update token whitelists if either token is in the whitelist
      await this.updateTokenWhitelists(id, currency0, currency1);
    } catch (error) {
      if (error.code === 11000) {
        this.logger.warn(`Duplicate pool initialization: ${id}`);
      } else {
        throw error;
      }
    }
  }

  private async handleSwapEventFromLog(event: ethers.EventLog) {
    const [poolId, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee] = event.args;

    await this.handleSwapEvent({
      poolId,
      sender,
      amount0,
      amount1,
      sqrtPriceX96,
      liquidity,
      tick,
      fee,
      event,
    });
  }

  private async handleModifyLiquidityEventFromLog(event: ethers.EventLog) {
    const [poolId, sender, tickLower, tickUpper, liquidityDelta, salt] = event.args;

    await this.handleModifyLiquidityEvent({
      poolId,
      sender,
      tickLower: Number(tickLower),
      tickUpper: Number(tickUpper),
      liquidityDelta,
      salt,
      event,
    });
  }

  private async handleSwapEvent(data: {
    poolId: string;
    sender: string;
    amount0: bigint;
    amount1: bigint;
    sqrtPriceX96: bigint;
    liquidity: bigint;
    tick: number;
    fee: number;
    event: ethers.EventLog;
  }) {
    const { poolId, sender, amount0, amount1, sqrtPriceX96, liquidity, tick, fee, event } = data;

    const block = await this.provider.getBlock(event.blockNumber);

    // Get token addresses from pool data
    const pool = await this.poolModel.findOne({ poolId });
    if (!pool) {
      this.logger.warn(`Pool not found for poolId: ${poolId}. Skipping swap event.`);
      return;
    }

    const token0Address = pool.currency0;
    const token1Address = pool.currency1;

    // Fetch token decimals
    const [token0Decimals, token1Decimals] = await Promise.all([
      this.fetchTokenDecimals(token0Address),
      this.fetchTokenDecimals(token1Address),
    ]);

    // Update pool prices and liquidity after swap with decimal adjustment
    const { token0Price, token1Price } = sqrtPriceX96ToTokenPrices(
      sqrtPriceX96.toString(),
      token0Decimals,
      token1Decimals,
    );

    // Update TVL by adding swap amounts (amount0 and amount1 represent deltas)
    const currentTVL0 = BigInt(pool.totalValueLockedToken0 || '0');
    const currentTVL1 = BigInt(pool.totalValueLockedToken1 || '0');
    const newTVL0 = currentTVL0 + amount0;
    const newTVL1 = currentTVL1 + amount1;

    await this.poolModel.updateOne(
      { poolId },
      {
        $set: {
          sqrtPriceX96: sqrtPriceX96.toString(),
          tick: Number(tick),
          token0Price,
          token1Price,
          liquidity: liquidity.toString(),
          totalValueLockedToken0: newTVL0.toString(),
          totalValueLockedToken1: newTVL1.toString(),
        },
      },
    );

    const swapEvent = {
      poolAddress: poolId,
      token0Address,
      token1Address,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      blockTimestamp: new Date(block.timestamp * 1000),
      sender,
      recipient: sender,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      sqrtPriceX96: sqrtPriceX96.toString(),
      liquidity: liquidity.toString(),
      tick: Number(tick),
      fee,
      token0Price,
      token1Price,
      logIndex: event.index,
      amountUSD: '0', // Will be calculated during aggregation
    };

    try {
      const savedEvent = await this.swapEventModel.create(swapEvent);
      this.logger.log(`New swap event: ${event.transactionHash} - Block ${event.blockNumber}`);

      // Emit event for WebSocket gateway
      this.eventEmitter.emit('swap.created', savedEvent);

      // Process aggregation directly
      await this.aggregationService.processSwapEvent(savedEvent);

      // Update sync state with latest block
      const poolManagerAddress = this.configService.uniswapV4PoolManagerAddress;
      await this.syncStateModel.updateOne(
        { poolManagerAddress },
        {
          lastSyncedBlock: event.blockNumber,
          currentBlock: event.blockNumber,
          lastSyncedAt: new Date(),
        },
      );
    } catch (error) {
      if (error.code === 11000) {
        this.logger.warn(`Duplicate swap event: ${event.transactionHash}`);
      } else {
        throw error;
      }
    }
  }

  private async handleModifyLiquidityEvent(data: {
    poolId: string;
    sender: string;
    tickLower: number;
    tickUpper: number;
    liquidityDelta: bigint;
    salt: string;
    event: ethers.EventLog;
  }) {
    const { poolId, tickLower, tickUpper, liquidityDelta, event } = data;

    try {
      // Get current pool state
      const pool = await this.poolModel.findOne({ poolId });
      if (!pool) {
        this.logger.warn(`Pool not found for poolId: ${poolId}. Skipping ModifyLiquidity event.`);
        return;
      }

      // Calculate new liquidity by adding liquidityDelta to current liquidity
      const currentLiquidity = BigInt(pool.liquidity || '0');
      const newLiquidity = currentLiquidity + liquidityDelta;

      // Calculate token amounts from liquidity delta using tick math
      const sqrtPriceX96 = BigInt(pool.sqrtPriceX96);
      const amount0 = getAmount0(tickLower, tickUpper, pool.tick, liquidityDelta, sqrtPriceX96);
      const amount1 = getAmount1(tickLower, tickUpper, pool.tick, liquidityDelta, sqrtPriceX96);

      // Update TVL by adding the calculated amounts
      const currentTVL0 = BigInt(pool.totalValueLockedToken0 || '0');
      const currentTVL1 = BigInt(pool.totalValueLockedToken1 || '0');
      const newTVL0 = currentTVL0 + amount0;
      const newTVL1 = currentTVL1 + amount1;

      // Update pool liquidity and TVL
      await this.poolModel.updateOne(
        { poolId },
        {
          $set: {
            liquidity: newLiquidity.toString(),
            totalValueLockedToken0: newTVL0.toString(),
            totalValueLockedToken1: newTVL1.toString(),
          },
        },
      );

      this.logger.log(
        `Updated pool ${poolId} - Liquidity: ${newLiquidity.toString()}, TVL0: ${newTVL0.toString()}, TVL1: ${newTVL1.toString()} - Block ${event.blockNumber}`,
      );
    } catch (error) {
      this.logger.error('Error handling ModifyLiquidity event', error);
      throw error;
    }
  }

  async getSwapEvents(
    poolAddress?: string,
    startTime?: Date,
    endTime?: Date,
    limit = 100,
  ): Promise<SwapEvent[]> {
    const query: any = {};

    if (poolAddress) {
      query.poolAddress = poolAddress;
    }

    if (startTime || endTime) {
      query.blockTimestamp = {};
      if (startTime) query.blockTimestamp.$gte = startTime;
      if (endTime) query.blockTimestamp.$lte = endTime;
    }

    return this.swapEventModel
      .find(query)
      .sort({ blockTimestamp: -1 })
      .limit(limit)
      .exec();
  }

  async getSyncState(): Promise<SyncState | null> {
    const poolManagerAddress = this.configService.uniswapV4PoolManagerAddress;
    return this.syncStateModel.findOne({ poolManagerAddress });
  }

  async getPoolByPoolId(poolId: string): Promise<Pool | null> {
    return this.poolModel.findOne({ poolId });
  }

  async getPoolsByCurrency(
    currency0?: string,
    currency1?: string,
    limit = 100,
  ): Promise<Pool[]> {
    const query: any = {};

    if (currency0) {
      query.currency0 = currency0;
    }

    if (currency1) {
      query.currency1 = currency1;
    }

    return this.poolModel
      .find(query)
      .sort({ blockTimestamp: -1 })
      .limit(limit)
      .exec();
  }

  async getAllPools(limit = 100): Promise<Pool[]> {
    return this.poolModel
      .find()
      .sort({ blockTimestamp: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Fetch token decimals with multi-level caching:
   * 1. Check in-memory cache
   * 2. Check database (Token collection)
   * 3. Fetch from contract as last resort
   */
  private async fetchTokenDecimals(tokenAddress: string): Promise<number> {
    // Level 1: Check in-memory cache first
    if (this.tokenDecimalsCache.has(tokenAddress)) {
      return this.tokenDecimalsCache.get(tokenAddress)!;
    }

    // Handle native token (ADDRESS_ZERO)
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      this.tokenDecimalsCache.set(tokenAddress, 18);
      return 18;
    }

    // Level 2: Check database (Token collection created by aggregation service)
    try {
      const token = await this.tokenModel.findOne({ address: tokenAddress });
      if (token && token.decimals !== undefined) {
        // Cache the result from database
        this.tokenDecimalsCache.set(tokenAddress, token.decimals);
        this.logger.debug(`Fetched decimals for ${tokenAddress} from database: ${token.decimals}`);
        return token.decimals;
      }
    } catch (error) {
      this.logger.warn(`Failed to query token from database: ${tokenAddress}`, error);
    }

    // Level 3: Fetch from contract as last resort
    try {
      console.log('fetching token decimals from contract for', tokenAddress);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const decimals = await contract.decimals();
      const decimalsNum = Number(decimals);

      // Cache the result
      this.tokenDecimalsCache.set(tokenAddress, decimalsNum);
      this.logger.debug(`Fetched decimals for ${tokenAddress} from contract: ${decimalsNum}`);

      return decimalsNum;
    } catch (error) {
      this.logger.warn(`Failed to fetch decimals for ${tokenAddress}, using default 18`);
      // Default to 18 decimals if fetch fails
      this.tokenDecimalsCache.set(tokenAddress, 18);
      return 18;
    }
  }

  /**
   * Update token whitelists when a pool with whitelisted tokens is created/updated
   */
  private async updateTokenWhitelists(poolId: string, currency0: string, currency1: string) {
    const whitelistTokens = this.configService.whitelistTokens;
    // Check if currency0 is whitelisted
    if (whitelistTokens.includes(currency0.toLowerCase())) {
      // Add pool to currency1's whitelist
      await this.updateTokenWhitelist(currency1, poolId);
    }

    // Check if currency1 is whitelisted
    if (whitelistTokens.includes(currency1.toLowerCase())) {
      // Add pool to currency0's whitelist
      await this.updateTokenWhitelist(currency0, poolId);
    }
  }

  /**
   * Add a pool to a token's whitelist if not already present
   */
  private async updateTokenWhitelist(tokenAddress: string, poolId: string) {
    try {
      // Call aggregation service directly to update whitelist
      await this.aggregationService.processTokenWhitelistUpdate({
        tokenAddress,
        poolId,
      });
    } catch (error) {
      this.logger.error(`Failed to update whitelist for token ${tokenAddress}`, error);
    }
  }
}