import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AggregationService, TimeInterval } from './aggregation.service';
import { TokenMinute } from './schemas/token-minute.schema';
import { TokenHour } from './schemas/token-hour.schema';
import { TokenDay } from './schemas/token-day.schema';
import { Token } from './schemas/token.schema';
import { SwapEvent } from '../swap-events/schemas/swap-event.schema';
import { Pool } from '../swap-events/schemas/pool.schema';
import { ConfigService } from '../config/config.service';

describe('AggregationService', () => {
  let service: AggregationService;
  let mockTokenMinuteModel: any;
  let mockTokenHourModel: any;
  let mockTokenDayModel: any;
  let mockTokenModel: any;
  let mockSwapEventModel: any;
  let mockPoolModel: any;
  let mockEventEmitter: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockTokenMinuteModel = {
      updateOne: jest.fn(),
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    mockTokenHourModel = {
      updateOne: jest.fn(),
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    mockTokenDayModel = {
      updateOne: jest.fn(),
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    mockTokenModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn(),
    };

    mockSwapEventModel = {
      distinct: jest.fn(),
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    };

    mockPoolModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    mockConfigService = {
      ethRpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/test',
      stablecoinWrappedNativePoolId: '0x0000000000000000000000000000000000000000',
      stablecoinIsToken0: true,
      wrappedNativeAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      whitelistTokens: [],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AggregationService,
        {
          provide: getModelToken(TokenMinute.name),
          useValue: mockTokenMinuteModel,
        },
        {
          provide: getModelToken(TokenHour.name),
          useValue: mockTokenHourModel,
        },
        {
          provide: getModelToken(TokenDay.name),
          useValue: mockTokenDayModel,
        },
        {
          provide: getModelToken(Token.name),
          useValue: mockTokenModel,
        },
        {
          provide: getModelToken(SwapEvent.name),
          useValue: mockSwapEventModel,
        },
        {
          provide: getModelToken(Pool.name),
          useValue: mockPoolModel,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AggregationService>(AggregationService);

    // Skip provider initialization in tests
    service['provider'] = {} as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTokenData', () => {
    it('should retrieve minute token data with filters', async () => {
      const mockTokenData = [
        {
          tokenAddress: '0xToken1',
          date: new Date(),
          volume: '1000',
          volumeUSD: '2000',
          untrackedVolumeUSD: '2000',
          totalValueLocked: '5000',
          totalValueLockedUSD: '10000',
          priceUSD: '2.5',
          feesUSD: '6',
          open: '2.0',
          high: '3.0',
          low: '1.5',
          close: '2.5',
          txCount: 10,
        },
      ];

      mockTokenMinuteModel.exec.mockResolvedValue(mockTokenData);

      const tokenAddress = '0xToken1';
      const interval = TimeInterval.MINUTE;
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-01-02');
      const limit = 50;

      const result = await service.getTokenData(
        tokenAddress,
        interval,
        startTime,
        endTime,
        limit,
      );

      expect(result).toEqual(mockTokenData);
      expect(mockTokenMinuteModel.find).toHaveBeenCalledWith({
        tokenAddress,
        date: { $gte: startTime, $lte: endTime },
      });
      expect(mockTokenMinuteModel.sort).toHaveBeenCalledWith({ date: -1 });
      expect(mockTokenMinuteModel.limit).toHaveBeenCalledWith(limit);
    });

    it('should retrieve hour token data without time filters', async () => {
      const mockTokenData = [];
      mockTokenHourModel.exec.mockResolvedValue(mockTokenData);

      const tokenAddress = '0xToken1';
      const interval = TimeInterval.HOUR;

      const result = await service.getTokenData(tokenAddress, interval);

      expect(result).toEqual(mockTokenData);
      expect(mockTokenHourModel.find).toHaveBeenCalledWith({
        tokenAddress,
      });
    });

    it('should retrieve day token data', async () => {
      const mockTokenData = [
        {
          tokenAddress: '0xToken1',
          date: new Date(),
          volume: '1000',
          volumeUSD: '2000',
          untrackedVolumeUSD: '2000',
          totalValueLocked: '5000',
          totalValueLockedUSD: '10000',
          priceUSD: '2.5',
          feesUSD: '6',
          open: '2.0',
          high: '3.0',
          low: '1.5',
          close: '2.5',
          txCount: 10,
        },
      ];

      mockTokenDayModel.exec.mockResolvedValue(mockTokenData);

      const tokenAddress = '0xToken1';
      const interval = TimeInterval.DAY;

      const result = await service.getTokenData(tokenAddress, interval);

      expect(result).toEqual(mockTokenData);
      expect(mockTokenDayModel.find).toHaveBeenCalledWith({
        tokenAddress,
      });
    });
  });
});
