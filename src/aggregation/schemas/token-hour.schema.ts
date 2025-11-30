import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TokenHourDocument = TokenHour & Document;

export enum RecordStatus {
  CURRENT = 'current', // Currently being updated in real-time
  FINALIZED = 'finalized', // Period ended, record is final
}

@Schema({ timestamps: true })
export class TokenHour {
  @Prop({ required: true, index: true })
  tokenAddress: string;

  @Prop({ required: true, index: true })
  date: Date;

  @Prop({ required: true, default: RecordStatus.CURRENT, index: true })
  status: RecordStatus;

  // Volume in token units
  @Prop({ required: true, default: '0' })
  volume: string;

  // Volume in derived USD
  @Prop({ required: true, default: '0' })
  volumeUSD: string;

  // Volume in USD even on pools with less reliable USD values
  @Prop({ required: true, default: '0' })
  untrackedVolumeUSD: string;

  // Liquidity across all pools in token units
  @Prop({ required: true, default: '0' })
  totalValueLocked: string;

  // Liquidity across all pools in derived USD
  @Prop({ required: true, default: '0' })
  totalValueLockedUSD: string;

  // Price at end of period in USD
  @Prop({ required: true, default: '0' })
  priceUSD: string;

  // Fees in USD
  @Prop({ required: true, default: '0' })
  feesUSD: string;

  // OHLC prices in USD
  @Prop({ default: '0' })
  open: string;

  @Prop({ default: '0' })
  high: string;

  @Prop({ default: '0' })
  low: string;

  @Prop({ default: '0' })
  close: string;

  // Transaction count
  @Prop({ required: true, default: 0 })
  txCount: number;
}

export const TokenHourSchema = SchemaFactory.createForClass(TokenHour);

// Unique index for token + date
TokenHourSchema.index({ tokenAddress: 1, date: 1 }, { unique: true });
