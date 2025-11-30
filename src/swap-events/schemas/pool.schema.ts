import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PoolDocument = Pool & Document;

@Schema({ timestamps: true })
export class Pool {
  @Prop({ required: true, unique: true, index: true, set: (val: string) => val.toLowerCase() })
  poolId: string; // bytes32 - pool ID hash

  @Prop({ required: true, index: true, set: (val: string) => val.toLowerCase() })
  currency0: string; // token0 address

  @Prop({ required: true, index: true, set: (val: string) => val.toLowerCase() })
  currency1: string; // token1 address

  @Prop({ required: true })
  fee: number; // uint24 - fee tier

  @Prop({ required: true })
  tickSpacing: number; // int24

  @Prop({ required: true, set: (val: string) => val.toLowerCase() })
  hooks: string; // hooks contract address

  @Prop({ required: true })
  sqrtPriceX96: string; // uint160 - initial price

  @Prop({ required: true })
  tick: number; // int24 - initial tick

  @Prop({ required: true })
  blockNumber: number;

  @Prop({ required: true })
  blockTimestamp: Date;

  @Prop({ required: true, set: (val: string) => val.toLowerCase() })
  transactionHash: string;

  @Prop({ default: '0' })
  token0Price: string; // price of token0 in terms of token1

  @Prop({ default: '0' })
  token1Price: string; // price of token1 in terms of token0

  @Prop({ default: '0' })
  liquidity: string; // uint128 - current liquidity in the pool

  @Prop({ default: '0' })
  totalValueLockedToken0: string; // total amount of token0 locked in the pool

  @Prop({ default: '0' })
  totalValueLockedToken1: string; // total amount of token1 locked in the pool
}

export const PoolSchema = SchemaFactory.createForClass(Pool);
