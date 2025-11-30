import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SyncStateDocument = SyncState & Document;

@Schema({ timestamps: true })
export class SyncState {
  @Prop({ required: true, unique: true })
  poolManagerAddress: string;

  @Prop({ required: true })
  lastSyncedBlock: number;

  @Prop({ required: true })
  currentBlock: number;

  @Prop({ default: false })
  isInitialSyncComplete: boolean;

  @Prop()
  lastSyncedAt: Date;
}

export const SyncStateSchema = SchemaFactory.createForClass(SyncState);
