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
  logger.header('🚀 Bitbank HFT Strategy Initialization');

  if (!config || !config.strategies || !config.strategies.HFT || config.strategies.HFT.enabled !== true) {
    logger.warn('HFT戦略が設定で無効化されています。');
    logger.info('HFTを有効にするには、.envファイルでHFT_ENABLED=trueを設定してください');
    return; // HFT戦略が無効な場合は何もしない
  }

  logger.info('✓ HFT戦略が有効化されています');
  logger.info(`Trading pairs: ${TRADING_PAIRS.join(', ')}`);
  logger.info(`Mock mode: ${WS_CONFIG.mockMode ? 'ON' : 'OFF'}`);

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
    logger.info('🔌 WebSocketストリームに接続中...');
    await publicClient.connect();
    logger.success('Public stream connected successfully');
    // TODO: プライベートストリームに接続
    // await privateClient.connect();

    logger.info('⚙️  取引戦略を初期化中...');
    // 取引ペアごとにストラテジー作成と購読開始
    for (const pair of TRADING_PAIRS) {
      // ストラテジーインスタンスの作成
      // TODO: HFTStrategy に必要な依存関係 (OrderProcessor, DBマネージャーなど) を渡す
      strategies[pair] = new HFTStrategy(pair, { STRATEGY_PARAMS, ...config }, dataStore, orderProcessor);
      logger.info(`  ✓ Strategy initialized for ${pair.toUpperCase()}`);

      // パブリックチャネルの購読
      publicClient.subscribePair(pair);
      logger.debug(`  📊 Subscribed to market data for ${pair.toUpperCase()}`);

      // TODO: プライベートチャネルの購読 (必要に応じて)
      // privateClient.subscribe('my_orders', { pair });
      // privateClient.subscribe('my_positions', { pair });
    }

    logger.success('🎯 Bitbank HFT Strategy started successfully');
    logger.separator();

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
    logger.error('❌ Bitbank HFT戦略の開始に失敗:', error.message);
    logger.debug('エラー詳細:', error);
    // エラー発生時のクリーンアップ
    stopHFTStrategy();
    throw error; // 起動失敗を通知
  }
}

/**
 * HFT 戦略を停止します。
 */
function stopHFTStrategy() {
  logger.header('🛑 Stopping Bitbank HFT Strategy');
  if (publicClient) {
    publicClient.disconnect();
    publicClient = null;
    logger.info('✓ パブリックストリームを切断');
  }
  if (privateClient) {
    privateClient.disconnect();
    privateClient = null;
    logger.info('✓ プライベートストリームを切断');
  }
  // TODO: その他のリソース解放
  logger.success('🏁 Bitbank HFT Strategy stopped successfully');
  logger.separator();
}

// src/config.js から呼び出せるようにエクスポート
module.exports = {
  startHFTStrategy,
  stopHFTStrategy
};