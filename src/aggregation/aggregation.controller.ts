import { Controller, Get, Query } from '@nestjs/common';
import { AggregationService, TimeInterval } from './aggregation.service';
import { TokenMinute } from './schemas/token-minute.schema';
import { TokenHour } from './schemas/token-hour.schema';
import { TokenDay } from './schemas/token-day.schema';

@Controller('token-data')
export class AggregationController {
  constructor(private readonly aggregationService: AggregationService) {}

  @Get()
  async getTokenData(
    @Query('tokenAddress') tokenAddress: string,
    @Query('interval') interval: TimeInterval,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('limit') limit?: string,
  ): Promise<(TokenMinute | TokenHour | TokenDay)[]> {
    const startDate = startTime ? new Date(startTime) : undefined;
    const endDate = endTime ? new Date(endTime) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : 100;

    return this.aggregationService.getTokenData(
      tokenAddress,
      interval,
      startDate,
      endDate,
      limitNum,
    );
  }
}
