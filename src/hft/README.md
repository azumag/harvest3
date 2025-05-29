# Bitbank HFT Implementation

This directory contains the implementation of high-frequency trading (HFT) strategies using bitbank's public stream WebSocket API.

## Features

- **Real-time market data streaming** via bitbank's public WebSocket API
- **Multi-currency pair support** - can handle multiple trading pairs simultaneously 
- **Socket.IO integration** - proper implementation of bitbank's WebSocket protocol
- **Mock mode** - for testing and development without external network access
- **Event-driven architecture** - using EventEmitter for real-time data processing

## Components

### WebSocket Client (`bitbank/WebSocketClient.js`)
- Handles Socket.IO connection to bitbank's stream endpoint
- Supports both production and mock modes
- Proper error handling and reconnection support

### Public Stream Client (`bitbank/PublicStreamClient.js`)
- Manages subscriptions to bitbank's public channels:
  - `ticker_{pair}` - Real-time price data
  - `transactions_{pair}` - Trade execution data  
  - `depth_whole_{pair}` - Full order book snapshots
  - `depth_diff_{pair}` - Order book updates
- Processes incoming messages in bitbank's format

### Market Data Store (`datastore/MarketDataStore.js`)
- Centralized storage for real-time market data
- Event emission for data updates
- Per-currency-pair data organization

### HFT Strategy (`strategy/HFTStrategy.js`)
- Processes real-time market data for trading decisions
- Price change monitoring with configurable thresholds
- Ready for custom trading logic implementation

## Configuration

Set the following environment variables:

```bash
STRATEGY_HFT_BB_WS_ENABLED=true  # Enable HFT strategy
HFT_MOCK_MODE=true               # Enable mock mode for testing
```

## Usage

### Running the HFT System

```bash
npm run start-hft
```

### Mock Mode vs Production

- **Mock Mode** (`HFT_MOCK_MODE=true`): Simulates WebSocket connections and generates test data
- **Production Mode** (`HFT_MOCK_MODE=false`): Connects to real bitbank WebSocket API

## Supported Currency Pairs

Currently configured for:
- `btc_jpy`
- `xrp_jpy` 
- `eth_jpy`

Additional pairs can be added in `config.js`.

## bitbank API Integration

The implementation follows bitbank's public stream API specification:

- **Endpoint**: `wss://stream.bitbank.cc`
- **Protocol**: Socket.IO with Engine.IO v4
- **Subscription**: `socket.emit('join-room', 'channel_name')`
- **Message Format**: `["message", {"room_name": "...", "message": {...}}]`

## Performance

The system is designed to handle multiple currency pairs in parallel with minimal latency. Each pair gets its own strategy instance while sharing the same WebSocket connection.

## Development

When adding new features:

1. Test in mock mode first
2. Ensure proper error handling
3. Follow the event-driven architecture
4. Add appropriate logging

For production deployment, ensure proper monitoring and reconnection logic is in place.