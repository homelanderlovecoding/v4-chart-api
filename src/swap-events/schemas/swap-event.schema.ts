import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SwapEventDocument = SwapEvent & Document;

@Schema({ timestamps: true })
export class SwapEvent {
  @Prop({ required: true, index: true })
  poolAddress: string;

  @Prop({ required: true, index: true })
  token0Address: string;

  @Prop({ required: true, index: true })
  token1Address: string;

  @Prop({ required: true })
  transactionHash: string;

  @Prop({ required: true })
  blockNumber: number;

  @Prop({ required: true, index: true })
  blockTimestamp: Date;

  @Prop({ required: true })
  sender: string;

  @Prop({ required: true })
  recipient: string;

  @Prop({ required: true })
  amount0: string;

  @Prop({ required: true })
  amount1: string;

  @Prop({ required: true })
  sqrtPriceX96: string;

  @Prop({ required: true })
  liquidity: string;

  @Prop({ required: true })
  tick: number;

  @Prop({ required: true })
  logIndex: number;

  @Prop({ required: true })
  fee: number;

  @Prop()
  amountUSD: string;
}

export const SwapEventSchema = SchemaFactory.createForClass(SwapEvent);

// Create compound index for efficient queries
SwapEventSchema.index({ poolAddress: 1, blockTimestamp: -1 });
SwapEventSchema.index({ transactionHash: 1, logIndex: 1 }, { unique: true });
