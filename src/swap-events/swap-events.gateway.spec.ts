import { Test, TestingModule } from '@nestjs/testing';
import { SwapEventsGateway } from './swap-events.gateway';
import { Server, Socket } from 'socket.io';

describe('SwapEventsGateway', () => {
  let gateway: SwapEventsGateway;
  let mockServer: Partial<Server>;
  let mockClient: Partial<Socket>;

  beforeEach(async () => {
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    mockClient = {
      id: 'test-client-id',
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SwapEventsGateway],
    }).compile();

    gateway = module.get<SwapEventsGateway>(SwapEventsGateway);
    gateway.server = mockServer as Server;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should log when client connects', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');
      gateway.handleConnection(mockClient as Socket);
      expect(logSpy).toHaveBeenCalledWith('Client connected: test-client-id');
    });
  });

  describe('handleDisconnect', () => {
    it('should clean up subscriptions when client disconnects', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      // Add client to subscriptions
      gateway['subscriptions'].set('all', new Set(['test-client-id']));
      gateway['candleSubscriptions'].set('0xToken:minute', new Set(['test-client-id']));

      gateway.handleDisconnect(mockClient as Socket);

      expect(logSpy).toHaveBeenCalledWith('Client disconnected: test-client-id');
      expect(gateway['subscriptions'].get('all')?.has('test-client-id')).toBe(false);
      expect(gateway['candleSubscriptions'].get('0xToken:minute')?.has('test-client-id')).toBe(false);
    });
  });

  describe('handleSubscribe', () => {
    it('should subscribe client to specific pool', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      gateway.handleSubscribe(mockClient as Socket, { poolAddress: '0xPool1' });

      expect(gateway['subscriptions'].get('0xPool1')?.has('test-client-id')).toBe(true);
      expect(logSpy).toHaveBeenCalledWith('Client test-client-id subscribed to 0xPool1');
      expect(mockClient.emit).toHaveBeenCalledWith('subscribed', { poolAddress: '0xPool1' });
    });

    it('should subscribe client to all pools', () => {
      gateway.handleSubscribe(mockClient as Socket, { poolAddress: 'all' });

      expect(gateway['subscriptions'].get('all')?.has('test-client-id')).toBe(true);
      expect(mockClient.emit).toHaveBeenCalledWith('subscribed', { poolAddress: 'all' });
    });
  });

  describe('handleCandleSubscribe', () => {
    it('should subscribe client to candle updates for specific token and interval', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      gateway.handleCandleSubscribe(mockClient as Socket, {
        tokenAddress: '0xTokenAddress',
        interval: 'minute',
      });

      expect(
        gateway['candleSubscriptions'].get('0xTokenAddress:minute')?.has('test-client-id'),
      ).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(
        'Client test-client-id subscribed to candles: 0xTokenAddress (minute)',
      );
      expect(mockClient.emit).toHaveBeenCalledWith('candleSubscribed', {
        tokenAddress: '0xTokenAddress',
        interval: 'minute',
      });
    });
  });

  describe('handleCandleUnsubscribe', () => {
    it('should unsubscribe client from candle updates', () => {
      const logSpy = jest.spyOn(gateway['logger'], 'log');

      // First subscribe
      gateway['candleSubscriptions'].set('0xToken:hour', new Set(['test-client-id']));

      // Then unsubscribe
      gateway.handleCandleUnsubscribe(mockClient as Socket, {
        tokenAddress: '0xToken',
        interval: 'hour',
      });

      expect(gateway['candleSubscriptions'].get('0xToken:hour')?.has('test-client-id')).toBe(false);
      expect(logSpy).toHaveBeenCalledWith(
        'Client test-client-id unsubscribed from candles: 0xToken (hour)',
      );
      expect(mockClient.emit).toHaveBeenCalledWith('candleUnsubscribed', {
        tokenAddress: '0xToken',
        interval: 'hour',
      });
    });
  });

  describe('handleSwapCreated', () => {
    it('should broadcast swap event to subscribed clients', () => {
      const mockSwapEvent = {
        poolAddress: '0xPool1',
        transactionHash: '0xTx1',
        blockNumber: 100,
        blockTimestamp: new Date(),
        token0Address: '0xToken0',
        token1Address: '0xToken1',
        sender: '0xSender1',
        recipient: '0xRecipient1',
        amount0: '1000',
        amount1: '2000',
        sqrtPriceX96: '1000000',
        liquidity: '5000',
        tick: 100,
        logIndex: 0,
        fee: 3000,
      };

      // Subscribe client to this pool
      gateway['subscriptions'].set('0xPool1', new Set(['test-client-id']));

      gateway.handleSwapCreated(mockSwapEvent as any);

      expect(mockServer.to).toHaveBeenCalledWith('test-client-id');
      expect(mockServer.emit).toHaveBeenCalledWith('swap', mockSwapEvent);
    });

    it('should broadcast swap event to clients subscribed to all pools', () => {
      const mockSwapEvent = {
        poolAddress: '0xPool1',
        transactionHash: '0xTx1',
        blockNumber: 100,
        blockTimestamp: new Date(),
        token0Address: '0xToken0',
        token1Address: '0xToken1',
        sender: '0xSender1',
        recipient: '0xRecipient1',
        amount0: '1000',
        amount1: '2000',
        sqrtPriceX96: '1000000',
        liquidity: '5000',
        tick: 100,
        logIndex: 0,
        fee: 3000,
      };

      // Subscribe client to all pools
      gateway['subscriptions'].set('all', new Set(['test-client-id']));

      gateway.handleSwapCreated(mockSwapEvent as any);

      expect(mockServer.to).toHaveBeenCalledWith('test-client-id');
      expect(mockServer.emit).toHaveBeenCalledWith('swap', mockSwapEvent);
    });
  });

  describe('handleCandleFinalized', () => {
    it('should broadcast finalized candle to subscribed clients', () => {
      const mockCandle = {
        interval: 'minute',
        tokenAddress: '0xToken1',
        date: new Date(),
        volume: '1000000000000000000',
        volumeUSD: '2000.000000',
        untrackedVolumeUSD: '2000.000000',
        totalValueLocked: '5000000000000000000',
        totalValueLockedUSD: '10000.000000',
        priceUSD: '2.500000',
        feesUSD: '6.000000',
        open: '2.000000',
        high: '3.000000',
        low: '1.500000',
        close: '2.500000',
        txCount: 42,
      };

      // Subscribe client to this token and interval
      gateway['candleSubscriptions'].set('0xToken1:minute', new Set(['test-client-id']));

      const logSpy = jest.spyOn(gateway['logger'], 'debug');

      gateway.handleCandleFinalized(mockCandle);

      expect(mockServer.to).toHaveBeenCalledWith('test-client-id');
      expect(mockServer.emit).toHaveBeenCalledWith('candle', mockCandle);
      expect(logSpy).toHaveBeenCalledWith(
        'Candle finalized broadcast: 0xToken1 (minute) - 1 clients',
      );
    });

    it('should broadcast finalized candle to clients subscribed to all tokens', () => {
      const mockCandle = {
        interval: 'hour',
        tokenAddress: '0xToken2',
        date: new Date(),
        volume: '1000000000000000000',
        volumeUSD: '2000.000000',
        untrackedVolumeUSD: '2000.000000',
        totalValueLocked: '5000000000000000000',
        totalValueLockedUSD: '10000.000000',
        priceUSD: '2.500000',
        feesUSD: '6.000000',
        open: '2.000000',
        high: '3.000000',
        low: '1.500000',
        close: '2.500000',
        txCount: 42,
      };

      // Subscribe client to all tokens for hour interval
      gateway['candleSubscriptions'].set('all:hour', new Set(['test-client-id']));

      gateway.handleCandleFinalized(mockCandle);

      expect(mockServer.to).toHaveBeenCalledWith('test-client-id');
      expect(mockServer.emit).toHaveBeenCalledWith('candle', mockCandle);
    });

    it('should not broadcast if no clients are subscribed', () => {
      const mockCandle = {
        interval: 'day',
        tokenAddress: '0xToken3',
        date: new Date(),
        volume: '1000000000000000000',
        volumeUSD: '2000.000000',
        untrackedVolumeUSD: '2000.000000',
        totalValueLocked: '5000000000000000000',
        totalValueLockedUSD: '10000.000000',
        priceUSD: '2.500000',
        feesUSD: '6.000000',
        open: '2.000000',
        high: '3.000000',
        low: '1.500000',
        close: '2.500000',
        txCount: 42,
      };

      gateway.handleCandleFinalized(mockCandle);

      expect(mockServer.to).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });
});
