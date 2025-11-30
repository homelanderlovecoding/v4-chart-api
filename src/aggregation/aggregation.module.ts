import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AggregationService } from './aggregation.service';
import { AggregationController } from './aggregation.controller';
import { TokenMinute, TokenMinuteSchema } from './schemas/token-minute.schema';
import { TokenHour, TokenHourSchema } from './schemas/token-hour.schema';
import { TokenDay, TokenDaySchema } from './schemas/token-day.schema';
import { Token, TokenSchema } from './schemas/token.schema';
import { SwapEvent, SwapEventSchema } from '../swap-events/schemas/swap-event.schema';
import { Pool, PoolSchema } from '../swap-events/schemas/pool.schema';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TokenMinute.name, schema: TokenMinuteSchema },
      { name: TokenHour.name, schema: TokenHourSchema },
      { name: TokenDay.name, schema: TokenDaySchema },
      { name: Token.name, schema: TokenSchema },
      { name: SwapEvent.name, schema: SwapEventSchema },
      { name: Pool.name, schema: PoolSchema },
    ]),
    ConfigModule,
  ],
  controllers: [AggregationController],
  providers: [AggregationService],
  exports: [AggregationService],
})
export class AggregationModule {}
