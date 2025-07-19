/**
 * 拡張Redisクライアント接続モジュール
 * SQLiteからRedisへの移行の一部として実装
 * Issue #4920: Redis接続安定性とパフォーマンスの大幅改善
 */
const redis = require('redis');
const { SETTINGS } = require('../config/settings');
const { MONITORING_SETTINGS } = require('../common/const');

// 環境変数からRedis接続URLを取得、または既定値を使用
// Docker環境では適切なサービス名を使用
const REDIS_URL = SETTINGS.DATABASE.REDIS.DEFAULT_URL;

// Redis接続の無効化フラグ
const DISABLE_REDIS = process.env.DISABLE_REDIS === 'true';

// Issue #4920: Redis接続プール設定の改善
const REDIS_POOL_CONFIG = {
  maxConnections: parseInt(process.env.REDIS_MAX_CONNECTIONS) || 10,
  minConnections: parseInt(process.env.REDIS_MIN_CONNECTIONS) || 2,
  acquireTimeoutMs: parseInt(process.env.REDIS_ACQUIRE_TIMEOUT) || 10000,
  idleTimeoutMs: parseInt(process.env.REDIS_IDLE_TIMEOUT) || 30000,
  connectionWarmupCount: parseInt(process.env.REDIS_WARMUP_COUNT) || 3
};

// Issue #4920: Circuit Breaker設定
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: parseInt(process.env.REDIS_FAILURE_THRESHOLD) || 5,
  resetTimeoutMs: parseInt(process.env.REDIS_RESET_TIMEOUT) || 60000,
  monitoringIntervalMs: parseInt(process.env.REDIS_MONITORING_INTERVAL) || 10000
};

// Issue #4920: 接続プールの状態管理
const connectionPool = [];
const circuitBreakerState = {
  failures: 0,
  lastFailureTime: 0,
  state: 'CLOSED' // CLOSED, OPEN, HALF_OPEN
};

// Issue #4920: 改善されたRedisクライアント設定
function createRedisClient() {
  return redis.createClient({
    url: REDIS_URL,
    socket: {
      connectTimeout: MONITORING_SETTINGS.REDIS_CONNECTION_TIMEOUT * 1.5, // Issue #4920: タイムアウト延長
      commandTimeout: MONITORING_SETTINGS.REDIS_CONNECTION_TIMEOUT * 1.2,
      // 再接続の設定 (Issue #4920: 更に改善された再接続設定)
      reconnectDelay: SETTINGS.DATABASE.REDIS.RECONNECT_DELAY,
      lazyConnect: true,
      // Issue #4920: 接続安定性の追加設定
      keepAlive: true,
      family: 4, // IPv4を明示的に使用
      noDelay: true, // TCP_NODELAYを有効化
      // Issue #4920: ソケットバッファサイズの最適化
      sendBuffer: 16384,
      recvBuffer: 16384
    },
    // Issue #4920: より堅牢で適応的な再試行戦略
    retry_strategy: (options) => {
      console.log(`[Redis Retry] 試行 ${options.attempt}, 経過時間: ${options.total_retry_time}ms`);
      
      if (options.error && options.error.code === 'ECONNREFUSED') {
        console.error('Redis接続が拒否されました。再接続を試みます...');
        // Issue #4920: 指数バックオフ + ジッターで再接続間隔を改善
        const baseDelay = Math.min(options.attempt * 200, SETTINGS.DATABASE.REDIS.RETRY_DELAY_MAX);
        const jitter = Math.random() * 1000; // 0-1秒のランダムジッター
        return baseDelay + jitter;
      }
      
      if (options.total_retry_time > SETTINGS.DATABASE.REDIS.CONNECTION_TIMEOUT) {
        console.error('Redis接続のタイムアウトに達しました。');
        return new Error('Redis接続のタイムアウトに達しました。');
      }
      
      // Issue #4920: 改善された指数バックオフ（ジッター付き）
      const exponentialDelay = Math.min(Math.pow(2, options.attempt - 1) * 1000, SETTINGS.DATABASE.REDIS.RETRY_DELAY_MAX);
      const jitter = Math.random() * 500; // 0-500msのジッター
      return exponentialDelay + jitter;
    }
  });
}

// 初期クライアント作成
const client = createRedisClient();

// Issue #4920: Circuit Breaker機能
function updateCircuitBreakerOnFailure() {
  circuitBreakerState.failures++;
  circuitBreakerState.lastFailureTime = Date.now();
  
  if (circuitBreakerState.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    circuitBreakerState.state = 'OPEN';
    console.warn(`[Circuit Breaker] Redis Circuit Breakerが開放されました (failures: ${circuitBreakerState.failures})`);
    
    // リセットタイマーをセット
    setTimeout(() => {
      circuitBreakerState.state = 'HALF_OPEN';
      console.log('[Circuit Breaker] Half-Open状態に移行しました');
    }, CIRCUIT_BREAKER_CONFIG.resetTimeoutMs);
  }
}

function updateCircuitBreakerOnSuccess() {
  if (circuitBreakerState.state === 'HALF_OPEN') {
    circuitBreakerState.state = 'CLOSED';
    circuitBreakerState.failures = 0;
    console.log('[Circuit Breaker] 正常状態に復旧しました');
  } else if (circuitBreakerState.state === 'CLOSED' && circuitBreakerState.failures > 0) {
    circuitBreakerState.failures = Math.max(0, circuitBreakerState.failures - 1);
  }
}

function isCircuitBreakerOpen() {
  return circuitBreakerState.state === 'OPEN';
}

// Issue #4920: 接続ウォーミング機能
async function warmupConnections() {
  console.log(`[Connection Warmup] ${REDIS_POOL_CONFIG.connectionWarmupCount}個の接続をウォーミング中...`);
  
  const warmupPromises = [];
  for (let i = 0; i < REDIS_POOL_CONFIG.connectionWarmupCount; i++) {
    warmupPromises.push(createAndTestConnection(i));
  }
  
  try {
    await Promise.allSettled(warmupPromises);
    console.log('[Connection Warmup] 接続ウォーミング完了');
  } catch (error) {
    console.warn(`[Connection Warmup] ウォーミング中にエラー: ${error.message}`);
  }
}

async function createAndTestConnection(index) {
  try {
    const testClient = createRedisClient();
    await testClient.connect();
    await testClient.ping(); // 接続テスト
    await testClient.quit();
    console.log(`[Connection Warmup] 接続 ${index + 1} のテスト成功`);
  } catch (error) {
    console.warn(`[Connection Warmup] 接続 ${index + 1} のテスト失敗: ${error.message}`);
    throw error;
  }
}

// イベントリスナーを追加
client.on('error', (err) => {
  if (!DISABLE_REDIS) {
    console.error('Redisエラー:', err);
    // Issue #4920: Circuit Breakerの状態更新
    updateCircuitBreakerOnFailure();
    
    // 接続エラーの場合は再接続を試みる
    if (err.code === 'ECONNREFUSED') {
      console.log(`Redis接続が拒否されました。${SETTINGS.DATABASE.REDIS.RECONNECTION_INTERVAL}ms後に再接続を試みます...`);
      setTimeout(() => {
        if (!client.isReady && !client.isOpen) {
          reconnect();
        }
      }, SETTINGS.DATABASE.REDIS.RECONNECTION_INTERVAL);
    }
  }
});

client.on('connect', () => {
  console.log(`Redisに接続しました: ${REDIS_URL}`);
  // Issue #4920: 成功時のCircuit Breaker状態更新
  updateCircuitBreakerOnSuccess();
});

client.on('ready', () => {
  console.log('Redisクライアントが準備完了しました');
  // Issue #4920: 成功時のCircuit Breaker状態更新
  updateCircuitBreakerOnSuccess();
});

client.on('end', () => {
  console.log('Redis接続が閉じられました');
});

client.on('reconnecting', () => {
  console.log('Redisに再接続中...');
});

// Issue #4920: 改善された自動再接続機能
async function reconnect() {
  // Circuit Breakerがオープンの場合は再接続をスキップ
  if (isCircuitBreakerOpen()) {
    console.log('[Redis Reconnect] Circuit Breakerが開放中のため再接続をスキップします');
    return;
  }
  
  try {
    if (!client.isReady && !client.isOpen) {
      console.log('Redisへ再接続を試みています...');
      await client.connect();
      
      // 接続テスト
      await client.ping();
      console.log('Redis再接続成功');
      updateCircuitBreakerOnSuccess();
    }
  } catch (err) {
    console.error('Redis再接続に失敗しました:', err);
    updateCircuitBreakerOnFailure();
    
    // 再接続に失敗した場合は、指数バックオフで再度試行
    const backoffDelay = Math.min(5000 * Math.pow(2, circuitBreakerState.failures), 60000);
    const jitter = Math.random() * 1000;
    setTimeout(() => {
      if (!client.isReady && !client.isOpen) {
        reconnect();
      }
    }, backoffDelay + jitter);
  }
}

/**
 * Issue #4920: 拡張Redisクライアント初期化関数
 * @returns {Promise} 接続完了時に解決されるPromise
 */
async function initRedisClient() {
  if (DISABLE_REDIS) {
    console.log('Redis接続が無効化されています');
    return null;
  }

  // Issue #4920: Circuit Breakerチェック
  if (isCircuitBreakerOpen()) {
    console.warn('[Redis Init] Circuit Breakerが開放中のため初期化をスキップします');
    return null;
  }

  try {
    if (!client.isReady && !client.isOpen) {
      console.log(`Redis接続を初期化しています: ${REDIS_URL}`);
      await client.connect();

      // Issue #4920: より堅牢な接続完了待機
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis接続タイムアウト'));
        }, MONITORING_SETTINGS.REDIS_CONNECTION_TIMEOUT + 10000); // Issue #4920: マージンを10秒に拡大

        if (client.isReady) {
          clearTimeout(timeout);
          resolve();
        } else {
          client.once('ready', () => {
            clearTimeout(timeout);
            resolve();
          });
          client.once('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        }
      });

      // Issue #4920: 接続テストと初期ウォーミング
      await client.ping();
      console.log('[Redis Init] 接続テスト成功');
      
      // Issue #4920: 非同期でウォーミングを実行（ブロックしない）
      setImmediate(() => {
        warmupConnections().catch(err => {
          console.warn(`[Redis Init] ウォーミング失敗 (継続可能): ${err.message}`);
        });
      });
      
      updateCircuitBreakerOnSuccess();
    }
    return client;
  } catch (error) {
    console.error('Redis接続に失敗しました:', error.message);
    updateCircuitBreakerOnFailure();
    // Issue #4920: 接続に失敗した場合でもnullを返してアプリケーションを続行
    return null;
  }
}

/**
 * Redisクライアントを終了する関数
 * @returns {Promise} 切断完了時に解決されるPromise
 */
async function closeRedisClient() {
  try {
    if (client.isOpen || client.isReady) {
      console.log('Redis接続を終了しています...');
      await client.quit();
    }
  } catch (error) {
    console.error('Redis接続終了時にエラーが発生しました:', error.message);
    // 強制的に接続を閉じる
    try {
      await client.disconnect();
    } catch (disconnectError) {
      console.error('Redis強制切断でもエラーが発生しました:', disconnectError.message);
    }
  }
}

/**
 * Redisクライアントを取得する関数
 * @returns {Object} Redis クライアント
 */
function getClient() {
  return client;
}

/**
 * Issue #4920: Circuit Breaker状態を取得する関数
 * @returns {Object} Circuit Breakerの状態情報
 */
function getCircuitBreakerState() {
  return {
    ...circuitBreakerState,
    isOpen: isCircuitBreakerOpen(),
    timeSinceLastFailure: Date.now() - circuitBreakerState.lastFailureTime
  };
}

/**
 * Issue #4920: 拡張接続ヘルスチェック機能
 * @returns {Promise<Object>} 詳細な接続状態情報
 */
async function getExtendedConnectionHealth() {
  const circuitState = getCircuitBreakerState();
  const basicHealth = {
    clientExists: !!client,
    clientReady: client?.isReady || false,
    clientOpen: client?.isOpen || false,
    clientStatus: client?.status || 'unknown'
  };

  let pingResult = null;
  if (basicHealth.clientReady && basicHealth.clientOpen && !circuitState.isOpen) {
    try {
      const start = Date.now();
      await client.ping();
      pingResult = {
        success: true,
        latency: Date.now() - start,
        error: null
      };
    } catch (error) {
      pingResult = {
        success: false,
        latency: null,
        error: error.message
      };
    }
  }

  return {
    ...basicHealth,
    circuitBreaker: circuitState,
    ping: pingResult,
    overallHealth: basicHealth.clientReady && basicHealth.clientOpen && 
                   !circuitState.isOpen && (pingResult?.success !== false)
  };
}

// モジュールのエクスポート
module.exports = {
  client,
  getClient,
  initRedisClient,
  closeRedisClient,
  reconnect,
  // Issue #4920: 新機能のエクスポート
  getCircuitBreakerState,
  getExtendedConnectionHealth,
  isCircuitBreakerOpen,
  warmupConnections,
  updateCircuitBreakerOnSuccess,
  updateCircuitBreakerOnFailure
};