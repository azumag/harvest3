// 設定ファイルのインポート
const { SETTINGS } = require('../config/settings');

// 取引対象の通貨ペア
const TRADING_PAIRS = SETTINGS.TRADING.TRADING_PAIRS;

// WebSocket接続設定
const WS_CONFIG = {
  publicStreamEndpoint: SETTINGS.HFT.WEBSOCKET.PUBLIC_ENDPOINT,
  privateStreamEndpoint: SETTINGS.HFT.WEBSOCKET.PRIVATE_ENDPOINT,
  reconnection: true,
  reconnectionAttempts: SETTINGS.HFT.WEBSOCKET.RECONNECTION_ATTEMPTS,
  reconnectionDelay: SETTINGS.HFT.WEBSOCKET.RECONNECTION_DELAY,
  timeout: SETTINGS.HFT.WEBSOCKET.TIMEOUT, // WebSocketClientで使用
  mockMode: process.env.HFT_MOCK_MODE === 'true', // テスト用モック機能
  logLevel: process.env.HFT_LOG_LEVEL || 'INFO' // ログレベル設定
};

// 戦略パラメータ
const STRATEGY_PARAMS = {
  priceThreshold: SETTINGS.HFT.STRATEGY.PRICE_THRESHOLD,      // 価格変動閾値（%）
  orderBookDepth: SETTINGS.HFT.STRATEGY.ORDER_BOOK_DEPTH,     // 注文板の深さ
  interval: SETTINGS.HFT.STRATEGY.EVALUATION_INTERVAL,        // 評価間隔（ms）
  tradePercentage: SETTINGS.HFT.STRATEGY.TRADE_PERCENTAGE     // 資金の使用割合
};

module.exports = {
  TRADING_PAIRS,
  WS_CONFIG,
  STRATEGY_PARAMS
};