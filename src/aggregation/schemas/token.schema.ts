import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TokenDocument = Token & Document;

@Schema({ timestamps: true })
export class Token {
  @Prop({ required: true, unique: true, set: (val: string) => val.toLowerCase() })
  address: string;

  @Prop()
  symbol: string;

  @Prop()
  name: string;

  @Prop({ required: true })
  decimals: number;

  // Cumulative volume in token units
  @Prop({ required: true, default: '0' })
  volume: string;

  // Cumulative volume in USD
  @Prop({ required: true, default: '0' })
  volumeUSD: string;

  // Cumulative untracked volume in USD
  @Prop({ required: true, default: '0' })
  untrackedVolumeUSD: string;

  // Cumulative fees in USD
  @Prop({ required: true, default: '0' })
  feesUSD: string;

  // Total value locked in token units
  @Prop({ required: true, default: '0' })
  totalValueLocked: string;

  // Total value locked in USD
  @Prop({ required: true, default: '0' })
  totalValueLockedUSD: string;

  // Token price derived in BTC
  @Prop({ required: true, default: '0' })
  derivedBTC: string;

  // Transaction count
  @Prop({ required: true, default: 0 })
  txCount: number;

  // Whitelist pools
  @Prop({ required: true, default: [], set: (val: string[]) => val.map(v => v.toLowerCase()) })
  whitelistPools: string[];
}

export const TokenSchema = SchemaFactory.createForClass(Token);
