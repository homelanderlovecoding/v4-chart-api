# Uniswap V4 Chart API

A real-time API service for tracking Uniswap V4 swap events, aggregating token data (OHLC, volume, TVL, fees), and streaming updates via WebSocket.

## Features

- 🔄 Real-time listening to Uniswap V4 swap events
- 🏊 Pool initialization tracking (Initialize events)
- 💾 MongoDB storage for swap events and pool data
- 🪙 Automatic token metadata fetching (decimals, symbol, name) from ERC20 contracts
- 📊 Token-based data aggregation for minute/hour/day intervals
- 📈 Volume tracking (token units & USD)
- 💰 TVL (Total Value Locked) tracking
- 💸 Fee tracking in USD
- 📉 OHLC (candlestick) price data in USD
- 🔌 WebSocket support for real-time event streaming
- 🧪 Unit tests included

## Tech Stack

- **NestJS** - TypeScript framework
- **MongoDB** - Database for events and aggregated data
- **Ethers.js** - Ethereum interaction
- **Socket.io** - WebSocket implementation
- **Jest** - Testing framework

## Prerequisites

- Node.js >= 20.0.0
- MongoDB (local or remote)
- Ethereum RPC endpoint (Alchemy, Infura, etc.)
- Uniswap V4 Pool Manager contract address

## Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Create a `.env` file from the example:

```bash
cp .env.example .env
```

3. Configure your environment variables in `.env`:

```env
MONGODB_URI=mongodb://localhost:27017/uniswap-v4
ETH_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/YOUR_API_KEY
UNISWAP_V4_POOL_MANAGER_ADDRESS=0xYourPoolManagerAddress
STARTING_BLOCK=0
SYNC_BATCH_SIZE=1000
PORT=3000
```

**Important**: Set `STARTING_BLOCK` to the block number where Uniswap V4 was deployed or where you want to start syncing events from.

## How It Works

### Initial Sync Process

When the application starts for the first time, it will:

1. **Sync Pool Initializations**: Query all Initialize events to track pool creation with token addresses

2. **Sync Historical Events**: Query all past swap events from `STARTING_BLOCK` to the current block
   - Processes blocks in batches (default: 1000 blocks per batch)
   - Saves sync progress to MongoDB (can resume if interrupted)
   - Shows progress percentage in logs

3. **Fetch Token Metadata**: When a new token is encountered during aggregation, the service automatically fetches:
   - Token decimals from the ERC20 contract
   - Token symbol
   - Token name
   - This ensures accurate volume and price calculations

4. **Start Real-time Listening**: Once sync is complete, listens for new swap events in real-time

5. **Resume on Restart**: If the app restarts, it resumes from the last synced block

### Monitoring Sync Progress

Check the sync status via the API:
```http
GET /swap-events/sync-state
```

Response:
```json
{
  "poolManagerAddress": "0x...",
  "lastSyncedBlock": 12345678,
  "currentBlock": 12356789,
  "isInitialSyncComplete": true,
  "lastSyncedAt": "2024-01-01T00:00:00.000Z"
}
```

## Running the Application

### Development mode with auto-reload:
```bash
npm run start:dev
```

### Production mode:
```bash
npm run build
npm run start:prod
```

## API Endpoints

### REST API

#### Get Swap Events
```http
GET /swap-events?poolAddress=0x...&startTime=2024-01-01&endTime=2024-01-02&limit=100
```

Query parameters:
- `poolAddress` (optional): Filter by pool address
- `startTime` (optional): Filter events after this timestamp (ISO 8601)
- `endTime` (optional): Filter events before this timestamp (ISO 8601)
- `limit` (optional): Maximum number of results (default: 100)

Response:
```json
[
  {
    "poolAddress": "0x...",
    "transactionHash": "0x...",
    "blockNumber": 12345678,
    "blockTimestamp": "2024-01-01T00:00:00.000Z",
    "sender": "0x...",
    "recipient": "0x...",
    "amount0": "1000000000000000000",
    "amount1": "2000000000000000000",
    "sqrtPriceX96": "1000000000000000000",
    "liquidity": "5000000000000000000",
    "tick": 100,
    "logIndex": 0
  }
]
```

#### Get Sync State
```http
GET /swap-events/sync-state
```

Response:
```json
{
  "poolManagerAddress": "0x...",
  "lastSyncedBlock": 12345678,
  "currentBlock": 12356789,
  "isInitialSyncComplete": true,
  "lastSyncedAt": "2024-01-01T00:00:00.000Z"
}
```

This endpoint helps monitor the historical sync progress. Use it to check if the initial sync is complete before querying historical data.

#### Get All Pools
```http
GET /swap-events/pools?limit=100
```

Query parameters:
- `limit` (optional): Maximum number of results (default: 100)

Response:
```json
[
  {
    "poolId": "0x1234...",
    "currency0": "0xA0b8...",
    "currency1": "0xC02a...",
    "fee": 3000,
    "tickSpacing": 60,
    "hooks": "0x0000...",
    "sqrtPriceX96": "79228162514264337593543950336",
    "tick": 0,
    "blockNumber": 12345678,
    "blockTimestamp": "2024-01-01T00:00:00.000Z",
    "transactionHash": "0xabc..."
  }
]
```

#### Get Pools by Currency
```http
GET /swap-events/pools?currency0=0xA0b8...&currency1=0xC02a...&limit=100
```

Query parameters:
- `currency0` (optional): Filter by first token address
- `currency1` (optional): Filter by second token address
- `limit` (optional): Maximum number of results (default: 100)

#### Get Pool by Pool ID
```http
GET /swap-events/pools/0x1234...
```

Response:
```json
{
  "poolId": "0x1234...",
  "currency0": "0xA0b8...",
  "currency1": "0xC02a...",
  "fee": 3000,
  "tickSpacing": 60,
  "hooks": "0x0000...",
  "sqrtPriceX96": "79228162514264337593543950336",
  "tick": 0,
  "blockNumber": 12345678,
  "blockTimestamp": "2024-01-01T00:00:00.000Z",
  "transactionHash": "0xabc..."
}
```

Use this endpoint to query token addresses (currency0, currency1) by pool ID from Initialize events.

#### Get Token Data
```http
GET /token-data?tokenAddress=0x...&interval=minute&startTime=2024-01-01&endTime=2024-01-02&limit=100
```

Query parameters:
- `tokenAddress` (required): Token contract address
- `interval` (required): Time interval - `minute`, `hour`, or `day`
- `startTime` (optional): Filter data after this timestamp (ISO 8601)
- `endTime` (optional): Filter data before this timestamp (ISO 8601)
- `limit` (optional): Maximum number of results (default: 100)

Response:
```json
[
  {
    "tokenAddress": "0x...",
    "date": "2024-01-01T00:00:00.000Z",
    "volume": "1000000000000000000",
    "volumeUSD": "2000000",
    "untrackedVolumeUSD": "2000000",
    "totalValueLocked": "5000000000000000000",
    "totalValueLockedUSD": "10000000",
    "priceUSD": "2.5",
    "feesUSD": "6000",
    "open": "2.0",
    "high": "3.0",
    "low": "1.5",
    "close": "2.5",
    "txCount": 42
  }
]
```

### WebSocket API

Connect to `ws://localhost:3000` using Socket.io client.

#### Subscribe to Real-Time Swap Events
```javascript
const socket = io('ws://localhost:3000');

// Subscribe to all pools
socket.emit('subscribe', { poolAddress: 'all' });

// Subscribe to specific pool
socket.emit('subscribe', { poolAddress: '0x...' });

// Listen for swap events
socket.on('swap', (event) => {
  console.log('New swap:', event);
});

// Unsubscribe
socket.emit('unsubscribe', { poolAddress: '0x...' });
```

#### Subscribe to Finalized Candle Events
When a candle period completes (minute/hour/day), the service fires a `candle` event to all subscribers:

```javascript
const socket = io('ws://localhost:3000');

// Subscribe to candles for a specific token and interval
socket.emit('subscribeCandle', {
  tokenAddress: '0xA0b8...',
  interval: 'minute'
});

// Subscribe to all tokens for a specific interval
socket.emit('subscribeCandle', {
  tokenAddress: 'all',
  interval: 'hour'
});

// Listen for finalized candles
socket.on('candle', (candle) => {
  console.log('Candle finalized:', candle);
  // candle = {
  //   interval: 'minute',
  //   tokenAddress: '0xA0b8...',
  //   date: '2024-01-01T12:34:00.000Z',
  //   volume: '1000000000000000000',
  //   volumeUSD: '2000.000000',
  //   untrackedVolumeUSD: '2000.000000',
  //   totalValueLocked: '5000000000000000000',
  //   totalValueLockedUSD: '10000.000000',
  //   priceUSD: '2.500000',
  //   feesUSD: '6.000000',
  //   open: '2.000000',
  //   high: '3.000000',
  //   low: '1.500000',
  //   close: '2.500000',
  //   txCount: 42
  // }
});

// Unsubscribe from candles
socket.emit('unsubscribeCandle', {
  tokenAddress: '0xA0b8...',
  interval: 'minute'
});
```

**Candle Finalization Schedule:**
- `minute` candles: Fired every minute after the minute completes
- `hour` candles: Fired every hour at minute 0 after the hour completes
- `day` candles: Fired every day at midnight after the day completes

## Data Aggregation Schedule

The service uses a **real-time aggregation** approach with automatic finalization:

### Real-Time Updates
- **Immediate**: Every swap event updates current period records (minute, hour, day) in real-time
- Records are marked as `current` while the period is active
- OHLC prices, volume, fees, and TVL are calculated and updated instantly

### Scheduled Finalization
The service finalizes completed period records at the following intervals:
- **tokenminutes**: Every minute - finalizes the previous minute's data
- **tokenhours**: Every hour at minute 0 - finalizes the previous hour's data
- **tokendays**: Every day at midnight - finalizes the previous day's data

### How It Works
1. **Swap Event Occurs**: Real-time listener catches the event
2. **Instant Update**: Current records for minute/hour/day are immediately updated
3. **Period Ends**: Cron job triggers at period boundary
4. **Finalization**: Previous period's `current` records become `finalized`
5. **New Period**: Next swap creates new `current` records for the new period

For each token, the service tracks:
- **Volume**: Total trading volume in token units and USD
- **TVL**: Total Value Locked across all pools
- **Fees**: Trading fees collected in USD (based on actual swap fee tier)
- **OHLC**: Open, High, Low, Close prices in USD
- **Transaction Count**: Number of swaps

Each collection is optimized for its specific time interval, improving query performance and data organization.

## Testing

Run the test suite:
```bash
npm test
```

Run tests with coverage:
```bash
npm run test:cov
```

Run tests in watch mode:
```bash
npm run test:watch
```

## Project Structure

```
src/
├── aggregation/
│   ├── schemas/
│   │   ├── token-minute.schema.ts  # Minute token data model
│   │   ├── token-hour.schema.ts    # Hour token data model
│   │   └── token-day.schema.ts     # Day token data model
│   ├── aggregation.controller.ts   # Token data REST endpoints
│   ├── aggregation.service.ts      # Aggregation logic & cron jobs
│   ├── aggregation.service.spec.ts # Tests
│   └── aggregation.module.ts
├── config/
│   ├── config.service.ts           # Configuration management
│   └── config.module.ts
├── swap-events/
│   ├── schemas/
│   │   ├── swap-event.schema.ts    # Swap event model (with token addresses)
│   │   ├── pool.schema.ts          # Pool initialization model (Initialize events)
│   │   └── sync-state.schema.ts    # Sync progress tracking
│   ├── swap-events.controller.ts   # Swap events REST endpoints
│   ├── swap-events.service.ts      # Event listener & storage
│   ├── swap-events.gateway.ts      # WebSocket gateway
│   ├── swap-events.service.spec.ts # Tests
│   └── swap-events.module.ts
├── app.module.ts                   # Main application module
└── main.ts                         # Application entry point
```

## MongoDB Collections

The service uses the following MongoDB collections:

### pools
Stores pool initialization data from Uniswap V4 Initialize events
- Indexes on: `poolId` (unique), `currency0`, `currency1`
- Contains: poolId, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick, blockNumber, blockTimestamp, transactionHash

### swapevents
Stores all swap events from Uniswap V4
- Indexes on: `poolAddress`, `token0Address`, `token1Address`, `blockTimestamp`, `(transactionHash, logIndex)` (unique)

### syncstates
Tracks historical sync progress
- Index on: `poolManagerAddress` (unique)

### tokenminutes
1-minute token data (volume, TVL, fees, OHLC)
- Unique index on: `(tokenAddress, date)`

### tokenhours
1-hour token data (volume, TVL, fees, OHLC)
- Unique index on: `(tokenAddress, date)`

### tokendays
1-day token data (volume, TVL, fees, OHLC)
- Unique index on: `(tokenAddress, date)`

### tokens
Token metadata and cumulative statistics
- Unique index on: `address`
- Contains: address, symbol, name, decimals, volume, volumeUSD, TVL, fees, txCount
- Token metadata (decimals, symbol, name) is automatically fetched from ERC20 contracts

## License

ISC
