const { TRADING_PAIRS, WS_CONFIG, STRATEGY_PARAMS } = require('./config');
const WebSocketClient = require('./bitbank/WebSocketClient');
const PublicStreamClient = require('./bitbank/PublicStreamClient');
const PrivateStreamClient = require('./bitbank/PrivateStreamClient');
const MarketDataStore = require('./datastore/MarketDataStore');
const HFTStrategy = require('./strategy/HFTStrategy');
const OrderProcessor = require('./strategy/OrderProcessor');
const Logger = require('./utils/Logger');

const logger = new Logger('HFTManager');

let publicClient = null;
let privateClient = null;
let dataStore = null;
let orderProcessor = null;
const strategies = {}; // 通貨ペアごとの戦略インスタンスを保持

/**
 * HFT 戦略を開始します。
 * @param {object} config - アプリケーション全体のconfig
 */
async function startHFTStrategy(config) {
  logger.info('Starting Bitbank HFT Strategy...');
  
  if (!config || !config.strategies || !config.strategies.HFT || config.strategies.HFT.enabled !== true) {
    logger.warn('HFT Strategy is disabled in the config.');
    return; // HFT戦略が無効な場合は何もしない
  }

  // データストアの初期化
  dataStore = new MarketDataStore();

  // OrderProcessor の初期化
  // TODO: OrderProcessor に必要な依存関係 (APIクライアント, DBマネージャー) を渡す
  orderProcessor = new OrderProcessor(config);

  // WebSocket クライアントの初期化
  publicClient = new PublicStreamClient(WS_CONFIG.publicStreamEndpoint, WS_CONFIG, dataStore);
  // TODO: PrivateStreamClient に必要な依存関係 (認証情報, DBマネージャー) を渡す
  privateClient = new PrivateStreamClient(WS_CONFIG.privateStreamEndpoint, WS_CONFIG);


  try {
    // WebSocket 接続
    await publicClient.connect();
    // TODO: プライベートストリームに接続
    // await privateClient.connect();

    // 取引ペアごとにストラテジー作成と購読開始
    for (const pair of TRADING_PAIRS) {
      // ストラテジーインスタンスの作成
      // TODO: HFTStrategy に必要な依存関係 (OrderProcessor, DBマネージャーなど) を渡す
      strategies[pair] = new HFTStrategy(pair, { STRATEGY_PARAMS, ...config }, dataStore, orderProcessor);
      logger.info(`Initialized strategy for pair: ${pair}`);

      // パブリックチャネルの購読
      publicClient.subscribePair(pair);

      // TODO: プライベートチャネルの購読 (必要に応じて)
      // privateClient.subscribe('my_orders', { pair });
      // privateClient.subscribe('my_positions', { pair });
    }

    logger.info('Bitbank HFT Strategy started successfully.');

    // データストアのイベントとストラテジーの連携
    dataStore.on('orderBookUpdate', (pair, data) => {
      if (strategies[pair]) {
        strategies[pair].processMarketData('orderBook', data);
      }
    });
    dataStore.on('tickerUpdate', (pair, data) => {
      if (strategies[pair]) {
        strategies[pair].processMarketData('ticker', data);
      }
    });
    // TODO: transactionsUpdate イベントのハンドリング

  } catch (error) {
    logger.error('Failed to start Bitbank HFT Strategy:', error);
    // エラー発生時のクリーンアップ
    stopHFTStrategy();
    throw error; // 起動失敗を通知
  }
}

/**
 * HFT 戦略を停止します。
 */
function stopHFTStrategy() {
  logger.info('Stopping Bitbank HFT Strategy...');
  if (publicClient) {
    publicClient.disconnect();
    publicClient = null;
  }
  if (privateClient) {
    privateClient.disconnect();
    privateClient = null;
  }
  // TODO: その他のリソース解放
  logger.info('Bitbank HFT Strategy stopped.');
}

// src/config.js から呼び出せるようにエクスポート
module.exports = {
  startHFTStrategy,
  stopHFTStrategy,
};