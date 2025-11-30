import { Controller, Get, Query, Param } from '@nestjs/common';
import { SwapEventsService } from './swap-events.service';
import { SwapEvent } from './schemas/swap-event.schema';
import { SyncState } from './schemas/sync-state.schema';
import { Pool } from './schemas/pool.schema';

@Controller('swap-events')
export class SwapEventsController {
  constructor(private readonly swapEventsService: SwapEventsService) {}

  @Get()
  async getSwapEvents(
    @Query('poolAddress') poolAddress?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('limit') limit?: string,
  ): Promise<SwapEvent[]> {
    const startDate = startTime ? new Date(startTime) : undefined;
    const endDate = endTime ? new Date(endTime) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : 100;

    return this.swapEventsService.getSwapEvents(
      poolAddress,
      startDate,
      endDate,
      limitNum,
    );
  }

  @Get('sync-state')
  async getSyncState(): Promise<SyncState | null> {
    return this.swapEventsService.getSyncState();
  }

  @Get('pools')
  async getPools(
    @Query('currency0') currency0?: string,
    @Query('currency1') currency1?: string,
    @Query('limit') limit?: string,
  ): Promise<Pool[]> {
    const limitNum = limit ? parseInt(limit, 10) : 100;

    if (currency0 || currency1) {
      return this.swapEventsService.getPoolsByCurrency(
        currency0,
        currency1,
        limitNum,
      );
    }

    return this.swapEventsService.getAllPools(limitNum);
  }

  @Get('pools/:poolId')
  async getPoolByPoolId(@Param('poolId') poolId: string): Promise<Pool | null> {
    return this.swapEventsService.getPoolByPoolId(poolId);
  }
}
