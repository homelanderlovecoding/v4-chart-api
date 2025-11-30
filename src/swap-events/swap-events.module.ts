import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SwapEventsService } from './swap-events.service';
import { SwapEventsController } from './swap-events.controller';
import { SwapEventsGateway } from './swap-events.gateway';
import { SwapEvent, SwapEventSchema } from './schemas/swap-event.schema';
import { SyncState, SyncStateSchema } from './schemas/sync-state.schema';
import { Pool, PoolSchema } from './schemas/pool.schema';
import { Token, TokenSchema } from '../aggregation/schemas/token.schema';
import { ConfigModule } from '../config/config.module';
import { AggregationModule } from '../aggregation/aggregation.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SwapEvent.name, schema: SwapEventSchema },
      { name: SyncState.name, schema: SyncStateSchema },
      { name: Pool.name, schema: PoolSchema },
      { name: Token.name, schema: TokenSchema },
    ]),
    ConfigModule,
    forwardRef(() => AggregationModule),
  ],
  controllers: [SwapEventsController],
  providers: [SwapEventsService, SwapEventsGateway],
  exports: [SwapEventsService],
})
export class SwapEventsModule {}
