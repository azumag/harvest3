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
    logger.warn('HFT Strategy is disabled in the config.');
    logger.info('To enable HFT, set HFT_ENABLED=true in your .env file');
    return; // HFT戦略が無効な場合は何もしない
  }

  logger.info('✓ HFT Strategy is enabled');
  logger.info(`Trading pairs: ${TRADING_PAIRS.join(', ')}`);
  logger.info(`Mock mode: ${WS_CONFIG.mockMode ? 'ON' : 'OFF'}`);

  // データストアの初期化
  dataStore = new MarketDataStore();

  // OrderProcessor の初期化
  // 取引所インスタンスを取得
  const exchange = config.exchanges && config.exchanges.bitbank && config.exchanges.bitbank.instance;
  if (!exchange) {
    logger.warn('No exchange instance found, OrderProcessor will run in mock mode');
  }
  orderProcessor = new OrderProcessor(config, exchange);

  // WebSocket クライアントの初期化
  publicClient = new PublicStreamClient(WS_CONFIG.publicStreamEndpoint, WS_CONFIG, dataStore);
  // PrivateStreamClient に認証情報と取引所インスタンスを渡す
  privateClient = new PrivateStreamClient(WS_CONFIG.privateStreamEndpoint, WS_CONFIG, exchange);


  try {
    // WebSocket 接続
    logger.info('🔌 Connecting to WebSocket streams...');
    await publicClient.connect();
    logger.success('Public stream connected successfully');
    
    // プライベートストリームに接続 (認証情報がある場合のみ)
    if (exchange && exchange.apiKey && exchange.secret) {
      try {
        await privateClient.connect();
        logger.success('Private stream connected successfully');
      } catch (error) {
        logger.warn('Private stream connection failed, continuing with public data only:', error.message);
      }
    } else {
      logger.info('No API credentials provided, running with public data only');
    }

    logger.info('⚙️  Initializing trading strategies...');
    // 取引ペアごとにストラテジー作成と購読開始
    for (const pair of TRADING_PAIRS) {
      // ストラテジーインスタンスの作成
      // OrderProcessor、データストア、設定を渡して初期化
      strategies[pair] = new HFTStrategy(pair, { STRATEGY_PARAMS, ...config }, dataStore, orderProcessor);
      logger.info(`  ✓ Strategy initialized for ${pair.toUpperCase()}`);

      // パブリックチャネルの購読
      publicClient.subscribePair(pair);
      logger.debug(`  📊 Subscribed to market data for ${pair.toUpperCase()}`);

      // プライベートチャネルの購読 (認証済みの場合)
      if (privateClient && privateClient.isAuthenticated) {
        try {
          privateClient.subscribe('orders', { pair });
          privateClient.subscribe('trades', { pair });
          privateClient.subscribe('balances');
          logger.debug(`  🔐 Subscribed to private channels for ${pair.toUpperCase()}`);
        } catch (error) {
          logger.warn(`Failed to subscribe to private channels for ${pair}:`, error.message);
        }
      }
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
    
    // トランザクションイベントのハンドリング
    dataStore.on('transactionsUpdate', (pair, data) => {
      if (strategies[pair]) {
        strategies[pair].processMarketData('transactions', data);
      }
    });
    
    // エラーイベントのハンドリング
    dataStore.on('error', (error) => {
      logger.error('MarketDataStore error:', error);
    });
    
    // パフォーマンス監視
    setInterval(() => {
      const stats = {
        strategies: Object.keys(strategies).length,
        activeSubscriptions: publicClient ? publicClient.getActiveSubscriptions().length : 0,
        dataStoreStats: dataStore.getStats()
      };
      logger.debug('HFT Performance Stats:', stats);
    }, 60000); // 1分ごと

  } catch (error) {
    logger.error('❌ Failed to start Bitbank HFT Strategy:', error.message);
    logger.debug('Error details:', error);
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
    logger.info('✓ Public stream disconnected');
  }
  if (privateClient) {
    privateClient.disconnect();
    privateClient = null;
    logger.info('✓ Private stream disconnected');
  }
  
  // ストラテジーのクリーンアップ
  Object.keys(strategies).forEach(pair => {
    strategies[pair] = null;
  });
  
  // データストアのクリーンアップ
  if (dataStore) {
    dataStore.removeAllListeners();
    dataStore = null;
  }
  
  // OrderProcessorのクリーンアップ
  if (orderProcessor) {
    orderProcessor = null;
  }
  
  logger.info('✓ All resources cleaned up');
  logger.success('🏁 Bitbank HFT Strategy stopped successfully');
  logger.separator();
}

// ステータス取得関数
function getHFTStatus() {
  return {
    running: publicClient !== null,
    strategies: Object.keys(strategies).length,
    publicConnected: publicClient && publicClient.isConnected(),
    privateConnected: privateClient && privateClient.isAuthenticated,
    lastUpdate: Date.now()
  };
}

// ストラテジー統計取得関数
function getHFTStats() {
  const stats = {};
  
  Object.keys(strategies).forEach(pair => {
    const strategy = strategies[pair];
    if (strategy) {
      stats[pair] = {
        tradeCount: strategy.tradeCount || 0,
        dailyPnL: strategy.dailyPnL || 0,
        lastTradeTime: strategy.lastTradeTime || 0,
        activePositions: strategy.positions ? strategy.positions.size : 0
      };
    }
  });
  
  return stats;
}

// src/config.js から呼び出せるようにエクスポート
module.exports = {
  startHFTStrategy,
  stopHFTStrategy,
  getHFTStatus,
  getHFTStats
};