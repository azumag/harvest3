// 取引対象の通貨ペア
const TRADING_PAIRS = [
  'btc_jpy',
  'xrp_jpy',
  'eth_jpy',
];

// WebSocket接続設定
const WS_CONFIG = {
  publicStreamEndpoint: 'wss://stream.bitbank.cc',
  privateStreamEndpoint: 'wss://private-ws.bitbank.cc',
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 10000, // WebSocketClientで使用
  mockMode: process.env.HFT_MOCK_MODE === 'true' // テスト用モック機能
};

// 戦略パラメータ
const STRATEGY_PARAMS = {
  priceThreshold: 0.001,      // 価格変動閾値（%）
  orderBookDepth: 15,         // 注文板の深さ
  interval: 100,              // 評価間隔（ms）
  tradePercentage: 0.001       // 資金の使用割合
};

module.exports = {
  TRADING_PAIRS,
  WS_CONFIG,
  STRATEGY_PARAMS,
};