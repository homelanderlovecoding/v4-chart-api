import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  get mongoUri(): string {
    return process.env.MONGODB_URI || 'mongodb://localhost:27017/uniswap-v4';
  }

  get ethRpcUrl(): string {
    return process.env.ETH_RPC_URL || 'https://eth-mainnet.alchemyapi.io/v2/YOUR_API_KEY';
  }

  get uniswapV4PoolManagerAddress(): string {
    return process.env.UNISWAP_V4_POOL_MANAGER_ADDRESS || '';
  }

  get port(): number {
    return parseInt(process.env.PORT || '3000', 10);
  }

  get startingBlock(): number {
    return parseInt(process.env.STARTING_BLOCK || '0', 10);
  }

  get syncBatchSize(): number {
    return parseInt(process.env.SYNC_BATCH_SIZE || '1000', 10);
  }

  get stablecoinWrappedNativePoolId(): string {
    return process.env.STABLECOIN_WRAPPED_NATIVE_POOL_ID || '';
  }

  get stablecoinIsToken0(): boolean {
    return process.env.STABLECOIN_IS_TOKEN0 === 'true';
  }

  get wrappedNativeAddress(): string {
    return process.env.WRAPPED_NATIVE_ADDRESS || '';
  }

  get whitelistTokens(): string[] {
    const tokens = process.env.WHITELIST_TOKENS || '';
    return tokens ? tokens.split(',').map(addr => addr.trim()) : [];
  }

  get stablecoinAddresses(): string[] {
    return process.env.STABLECOIN_ADDRESSES ? process.env.STABLECOIN_ADDRESSES.split(',').map(addr => addr.trim()) : [];
  }
}
