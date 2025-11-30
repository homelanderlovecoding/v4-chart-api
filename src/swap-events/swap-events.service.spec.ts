import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SwapEventsService } from './swap-events.service';
import { SwapEvent } from './schemas/swap-event.schema';
import { SyncState } from './schemas/sync-state.schema';
import { Pool } from './schemas/pool.schema';
import { Token } from '../aggregation/schemas/token.schema';
import { ConfigService } from '../config/config.service';

describe('SwapEventsService', () => {
  let service: SwapEventsService;
  let mockSwapEventModel: any;
  let mockSyncStateModel: any;
  let mockPoolModel: any;
  let mockTokenModel: any;
  let mockConfigService: any;
  let mockEventEmitter: any;

  beforeEach(async () => {
    mockSwapEventModel = {
      create: jest.fn(),
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn(),
      distinct: jest.fn(),
    };

    mockSyncStateModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
      save: jest.fn(),
    };

    mockPoolModel = {
      create: jest.fn(),
      findOne: jest.fn(),
    };

    mockTokenModel = {
      findOne: jest.fn(),
    };

    mockConfigService = {
      ethRpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/test',
      uniswapV4PoolManagerAddress: '0x0000000000000000000000000000000000000000',
      startingBlock: 0,
      syncBatchSize: 1000,
      whitelistTokens: [],
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SwapEventsService,
        {
          provide: getModelToken(SwapEvent.name),
          useValue: mockSwapEventModel,
        },
        {
          provide: getModelToken(SyncState.name),
          useValue: mockSyncStateModel,
        },
        {
          provide: getModelToken(Pool.name),
          useValue: mockPoolModel,
        },
        {
          provide: getModelToken(Token.name),
          useValue: mockTokenModel,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    })
      .overrideProvider(SwapEventsService)
      .useValue({
        getSwapEvents: jest.fn(),
        getSyncState: jest.fn(),
        getPoolByPoolId: jest.fn(),
        getPoolsByCurrency: jest.fn(),
        getAllPools: jest.fn(),
      })
      .compile();

    service = module.get<SwapEventsService>(SwapEventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSwapEvents', () => {
    it('should retrieve swap events with filters', async () => {
      const mockEvents = [
        {
          poolAddress: '0xPool1',
          transactionHash: '0xTx1',
          blockNumber: 100,
          blockTimestamp: new Date(),
          sender: '0xSender1',
          recipient: '0xRecipient1',
          amount0: '1000',
          amount1: '2000',
          sqrtPriceX96: '1000000',
          liquidity: '5000',
          tick: 100,
          logIndex: 0,
        },
      ];

      (service.getSwapEvents as jest.Mock).mockResolvedValue(mockEvents);

      const poolAddress = '0xPool1';
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-01-02');
      const limit = 50;

      const result = await service.getSwapEvents(
        poolAddress,
        startTime,
        endTime,
        limit,
      );

      expect(result).toEqual(mockEvents);
      expect(service.getSwapEvents).toHaveBeenCalledWith(
        poolAddress,
        startTime,
        endTime,
        limit,
      );
    });

    it('should retrieve swap events without filters', async () => {
      const mockEvents = [];
      (service.getSwapEvents as jest.Mock).mockResolvedValue(mockEvents);

      const result = await service.getSwapEvents();

      expect(result).toEqual(mockEvents);
      expect(service.getSwapEvents).toHaveBeenCalled();
    });
  });

  describe('getSyncState', () => {
    it('should return sync state', async () => {
      const mockSyncState = {
        poolManagerAddress: '0x0000000000000000000000000000000000000000',
        lastSyncedBlock: 12345678,
        currentBlock: 12356789,
        isInitialSyncComplete: true,
        lastSyncedAt: new Date(),
      };

      (service.getSyncState as jest.Mock).mockResolvedValue(mockSyncState);

      const result = await service.getSyncState();

      expect(result).toEqual(mockSyncState);
      expect(service.getSyncState).toHaveBeenCalled();
    });
  });

  describe('getPoolByPoolId', () => {
    it('should retrieve a pool by pool ID', async () => {
      const mockPool = {
        poolId: '0x1234567890abcdef',
        currency0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        currency1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        fee: 3000,
        tickSpacing: 60,
        hooks: '0x0000000000000000000000000000000000000000',
        sqrtPriceX96: '79228162514264337593543950336',
        tick: 0,
        blockNumber: 12345678,
        blockTimestamp: new Date(),
        transactionHash: '0xabc123',
      };

      (service.getPoolByPoolId as jest.Mock).mockResolvedValue(mockPool);

      const result = await service.getPoolByPoolId('0x1234567890abcdef');

      expect(result).toEqual(mockPool);
      expect(service.getPoolByPoolId).toHaveBeenCalledWith('0x1234567890abcdef');
    });

    it('should return null if pool not found', async () => {
      (service.getPoolByPoolId as jest.Mock).mockResolvedValue(null);

      const result = await service.getPoolByPoolId('0xnonexistent');

      expect(result).toBeNull();
      expect(service.getPoolByPoolId).toHaveBeenCalledWith('0xnonexistent');
    });
  });

  describe('getPoolsByCurrency', () => {
    it('should retrieve pools by currency0 and currency1', async () => {
      const mockPools = [
        {
          poolId: '0x1234567890abcdef',
          currency0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          currency1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          fee: 3000,
          tickSpacing: 60,
          hooks: '0x0000000000000000000000000000000000000000',
          sqrtPriceX96: '79228162514264337593543950336',
          tick: 0,
          blockNumber: 12345678,
          blockTimestamp: new Date(),
          transactionHash: '0xabc123',
        },
      ];

      (service.getPoolsByCurrency as jest.Mock).mockResolvedValue(mockPools);

      const result = await service.getPoolsByCurrency(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        100,
      );

      expect(result).toEqual(mockPools);
      expect(service.getPoolsByCurrency).toHaveBeenCalledWith(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        100,
      );
    });

    it('should retrieve pools by currency0 only', async () => {
      const mockPools = [];
      (service.getPoolsByCurrency as jest.Mock).mockResolvedValue(mockPools);

      const result = await service.getPoolsByCurrency(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        undefined,
        100,
      );

      expect(result).toEqual(mockPools);
      expect(service.getPoolsByCurrency).toHaveBeenCalledWith(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        undefined,
        100,
      );
    });
  });

  describe('getAllPools', () => {
    it('should retrieve all pools with default limit', async () => {
      const mockPools = [
        {
          poolId: '0x1234567890abcdef',
          currency0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          currency1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          fee: 3000,
          tickSpacing: 60,
          hooks: '0x0000000000000000000000000000000000000000',
          sqrtPriceX96: '79228162514264337593543950336',
          tick: 0,
          blockNumber: 12345678,
          blockTimestamp: new Date(),
          transactionHash: '0xabc123',
        },
        {
          poolId: '0xfedcba0987654321',
          currency0: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
          currency1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          fee: 500,
          tickSpacing: 10,
          hooks: '0x0000000000000000000000000000000000000000',
          sqrtPriceX96: '79228162514264337593543950336',
          tick: 0,
          blockNumber: 12345679,
          blockTimestamp: new Date(),
          transactionHash: '0xdef456',
        },
      ];

      (service.getAllPools as jest.Mock).mockResolvedValue(mockPools);

      const result = await service.getAllPools(100);

      expect(result).toEqual(mockPools);
      expect(service.getAllPools).toHaveBeenCalledWith(100);
    });
  });
});
