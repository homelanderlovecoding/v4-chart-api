import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SwapEvent } from './schemas/swap-event.schema';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class SwapEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SwapEventsGateway.name);
  private subscriptions: Map<string, Set<string>> = new Map();
  private candleSubscriptions: Map<string, Set<string>> = new Map(); // tokenAddress:interval -> clientIds

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Clean up subscriptions
    this.subscriptions.forEach((clients) => {
      clients.delete(client.id);
    });
    // Clean up candle subscriptions
    this.candleSubscriptions.forEach((clients) => {
      clients.delete(client.id);
    });
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, payload: { poolAddress?: string }) {
    const poolAddress = payload.poolAddress || 'all';

    if (!this.subscriptions.has(poolAddress)) {
      this.subscriptions.set(poolAddress, new Set());
    }

    this.subscriptions.get(poolAddress).add(client.id);

    this.logger.log(`Client ${client.id} subscribed to ${poolAddress}`);
    client.emit('subscribed', { poolAddress });
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, payload: { poolAddress?: string }) {
    const poolAddress = payload.poolAddress || 'all';

    if (this.subscriptions.has(poolAddress)) {
      this.subscriptions.get(poolAddress).delete(client.id);
      this.logger.log(`Client ${client.id} unsubscribed from ${poolAddress}`);
    }

    client.emit('unsubscribed', { poolAddress });
  }

  @SubscribeMessage('subscribeCandle')
  handleCandleSubscribe(
    client: Socket,
    payload: { tokenAddress: string; interval: string },
  ) {
    const { tokenAddress, interval } = payload;
    const subscriptionKey = `${tokenAddress}:${interval}`;

    if (!this.candleSubscriptions.has(subscriptionKey)) {
      this.candleSubscriptions.set(subscriptionKey, new Set());
    }

    this.candleSubscriptions.get(subscriptionKey).add(client.id);

    this.logger.log(
      `Client ${client.id} subscribed to candles: ${tokenAddress} (${interval})`,
    );
    client.emit('candleSubscribed', { tokenAddress, interval });
  }

  @SubscribeMessage('unsubscribeCandle')
  handleCandleUnsubscribe(
    client: Socket,
    payload: { tokenAddress: string; interval: string },
  ) {
    const { tokenAddress, interval } = payload;
    const subscriptionKey = `${tokenAddress}:${interval}`;

    if (this.candleSubscriptions.has(subscriptionKey)) {
      this.candleSubscriptions.get(subscriptionKey).delete(client.id);
      this.logger.log(
        `Client ${client.id} unsubscribed from candles: ${tokenAddress} (${interval})`,
      );
    }

    client.emit('candleUnsubscribed', { tokenAddress, interval });
  }

  @OnEvent('swap.created')
  handleSwapCreated(swapEvent: SwapEvent) {
    // Send to clients subscribed to this specific pool
    if (this.subscriptions.has(swapEvent.poolAddress)) {
      const clients = this.subscriptions.get(swapEvent.poolAddress);
      clients.forEach((clientId) => {
        this.server.to(clientId).emit('swap', swapEvent);
      });
    }

    // Send to clients subscribed to all pools
    if (this.subscriptions.has('all')) {
      const clients = this.subscriptions.get('all');
      clients.forEach((clientId) => {
        this.server.to(clientId).emit('swap', swapEvent);
      });
    }

    this.logger.debug(`Swap event broadcast: ${swapEvent.transactionHash}`);
  }

  @OnEvent('candle.finalized')
  handleCandleFinalized(candle: any) {
    const { interval, tokenAddress } = candle;
    const subscriptionKey = `${tokenAddress}:${interval}`;

    // Send to clients subscribed to this specific token + interval
    if (this.candleSubscriptions.has(subscriptionKey)) {
      const clients = this.candleSubscriptions.get(subscriptionKey);
      clients.forEach((clientId) => {
        this.server.to(clientId).emit('candle', candle);
      });

      this.logger.debug(
        `Candle finalized broadcast: ${tokenAddress} (${interval}) - ${clients.size} clients`,
      );
    }

    // Also send to 'all' subscription for this interval
    const allKey = `all:${interval}`;
    if (this.candleSubscriptions.has(allKey)) {
      const clients = this.candleSubscriptions.get(allKey);
      clients.forEach((clientId) => {
        this.server.to(clientId).emit('candle', candle);
      });
    }
  }
}
