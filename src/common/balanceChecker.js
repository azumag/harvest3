/**
 * 残高チェッカー - 取引所残高とbot管理残高の比較・監視
 * geminiの指摘に基づく堅牢な実装（設定外部化対応）
 */
const { config } = require('../config');
const { getValidatedConfig } = require('./balanceCheckerConfig');
const { postErrorToDiscord, postOrderToDiscord } = require('./notifications');
const { 
  getClient: getRedisClient,
  getAllPositionsRedis,
  getAllTradeSummaries
} = require('../database/redisDatabase');
const { 
  getAllTradeSummaries: getAllTradeSummariesFromDB,
  getTradeCurrentPosition
} = require('../database/manager');
const { getBalanceCheckEligibleStrategies } = require('./strategyUtils');

// 設定の取得
const BALANCE_CONFIG = getValidatedConfig();

/**
 * 取引所残高を取得する
 * @param {string} exchangeId - 取引所ID
 * @returns {Object} 取引所の残高情報
 */
async function getExchangeBalance(exchangeId) {
  try {
    const exchangeConfig = config.exchanges[exchangeId];
    if (!exchangeConfig) {
      throw new Error(`Exchange ${exchangeId} not found in config`);
    }

    const exchange = exchangeConfig.instance;
    const balance = await exchange.fetchBalance();
    
    console.log(`取引所残高取得完了: ${exchangeId}`);
    return balance;
  } catch (error) {
    console.error(`取引所残高取得エラー (${exchangeId}):`, error.message);
    throw error;
  }
}

/**
 * botで管理している未売却ポジションから計算した残高を取得する
 * @returns {Object} 通貨別の未売却ポジション残高
 */
async function getBotManagedBalance() {
  try {
    // Redisから全ポジションを取得
    const allPositions = await getAllPositionsRedis();
    
    // 買いポジション（未売却）のみを抽出
    const buyPositions = allPositions.filter(position => 
      position.side === 'buy' && 
      position.status !== 'closed' // クローズされていないポジション
    );
    
    // 通貨別に集計
    const currencyBalances = {};
    
    buyPositions.forEach(position => {
      // シンボルから基軸通貨を抽出 (例: BTC/JPY -> BTC)
      const [baseCurrency] = position.symbol.split('/');
      
      if (!currencyBalances[baseCurrency]) {
        currencyBalances[baseCurrency] = 0;
      }
      
      currencyBalances[baseCurrency] += position.amount || 0;
    });
    
    console.log('Bot管理残高計算完了:', currencyBalances);
    return currencyBalances;
  } catch (error) {
    console.error('Bot管理残高取得エラー:', error.message);
    throw error;
  }
}

/**
 * 残高を比較し、不整合があればDiscordに通知する
 * @param {string} exchangeId - 取引所ID
 * @param {number} thresholdPercent - 許容誤差（パーセント）- 完全一致チェックのため0
 */
async function compareBalances(exchangeId, thresholdPercent = 0) {
  try {
    console.log(`残高比較開始: ${exchangeId}`);
    
    // 取引所残高を取得
    const exchangeBalance = await getExchangeBalance(exchangeId);
    
    // Bot管理残高を取得
    const botBalance = await getBotManagedBalance();
    
    // 比較対象の通貨一覧（両方に存在する通貨 + 一定額以上の通貨）
    const significantThreshold = BALANCE_CONFIG.thresholds.significantBalance;
    const exchangeCurrencies = Object.keys(exchangeBalance.total).filter(
      currency => exchangeBalance.total[currency] >= significantThreshold
    );
    const botCurrencies = Object.keys(botBalance);
    const allCurrencies = [...new Set([...exchangeCurrencies, ...botCurrencies])];
    
    const discrepancies = [];
    
    for (const currency of allCurrencies) {
      // JPYは残高チェックから除外
      if (currency === 'JPY') {
        continue;
      }
      
      const exchangeAmount = exchangeBalance.total[currency] || 0;
      const botAmount = botBalance[currency] || 0;
      
      // 有意な差がある場合のみチェック
      if (Math.max(exchangeAmount, botAmount) < significantThreshold) {
        continue;
      }
      
      // 差異の計算（完全一致チェック）
      const difference = Math.abs(exchangeAmount - botAmount);
      const maxAmount = Math.max(exchangeAmount, botAmount);
      const discrepancyPercent = maxAmount > 0 ? (difference / maxAmount) * 100 : 0;
      
      // 完全一致でない場合は全て通知（閾値0%）
      if (difference > 0) {
        discrepancies.push({
          currency,
          exchangeAmount,
          botAmount,
          difference,
          discrepancyPercent: Math.round(discrepancyPercent * 100) / 100
        });
      }
    }
    
    // 不整合があればDiscordに通知
    if (discrepancies.length > 0) {
      const message = createDiscrepancyMessage(exchangeId, discrepancies);
      await postOrderToDiscord(message);
      console.error(`残高不整合検出: ${exchangeId}`, discrepancies);
    } else {
      console.log(`残高チェック正常: ${exchangeId}`);
    }
    
    return {
      exchangeId,
      discrepancies,
      isHealthy: discrepancies.length === 0
    };
    
  } catch (error) {
    const errorMessage = `残高比較エラー (${exchangeId}): ${error.message}`;
    console.error(errorMessage);
    await postErrorToDiscord(errorMessage);
    throw error;
  }
}

/**
 * 不整合メッセージを作成する
 * @param {string} exchangeId - 取引所ID
 * @param {Array} discrepancies - 不整合データ
 * @returns {string} Discord用メッセージ
 */
function createDiscrepancyMessage(exchangeId, discrepancies) {
  let message = `🚨 **残高不整合検出** (${exchangeId})\n`;
  message += `検出時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n\n`;
  
  discrepancies.forEach(disc => {
    message += `**${disc.currency}**\n`;
    message += `・取引所残高: ${disc.exchangeAmount.toFixed(6)}\n`;
    message += `・Bot管理残高: ${disc.botAmount.toFixed(6)}\n`;
    message += `・差異: ${disc.difference.toFixed(6)} (${disc.discrepancyPercent}%)\n\n`;
  });
  
  message += '⚠️ 手動確認と調整が必要です。';
  
  return message;
}

/**
 * 全取引所の残高チェックを実行
 */
async function checkAllExchangeBalances() {
  try {
    console.log('=== 全取引所残高チェック開始 ===');
    
    const results = [];
    const exchangeIds = Object.keys(config.exchanges);
    
    for (const exchangeId of exchangeIds) {
      try {
        const result = await compareBalances(exchangeId);
        results.push(result);
        
        // 各取引所チェック間の待機（設定から取得）
        await new Promise(resolve => setTimeout(resolve, BALANCE_CONFIG.intervals.exchangeCheckDelay));
      } catch (error) {
        console.error(`${exchangeId} の残高チェックに失敗:`, error.message);
        results.push({
          exchangeId,
          error: error.message,
          isHealthy: false
        });
      }
    }
    
    console.log('=== 全取引所残高チェック完了 ===');
    return results;
    
  } catch (error) {
    const errorMessage = `全取引所残高チェックエラー: ${error.message}`;
    console.error(errorMessage);
    await postErrorToDiscord(errorMessage);
    throw error;
  }
}

/**
 * 単一取引所の残高チェック（bot.jsとの互換性のため）
 * @param {string} exchangeId - 取引所ID
 * @returns {Object} 残高チェック結果
 */
async function checkSingleExchange(exchangeId) {
  try {
    const result = await compareBalances(exchangeId);
    return {
      exchangeId: result.exchangeId,
      discrepancies: result.discrepancies,
      discrepancyCount: result.discrepancies.length,
      isHealthy: result.isHealthy
    };
  } catch (error) {
    console.error(`checkSingleExchange error for ${exchangeId}:`, error.message);
    throw error;
  }
}

/**
 * チェック状態の管理（Redis）- 設定から取得
 */
const CHECKER_STATE_KEY = BALANCE_CONFIG.distributedLock.stateKey;
const CHECKER_LOCK_KEY = BALANCE_CONFIG.distributedLock.lockKeyPrefix;
const LOCK_TTL = BALANCE_CONFIG.distributedLock.defaultTtl;

/**
 * チェック状態
 */
const STATE = {
  OK: 'OK',
  ERROR: 'ERROR',
  PROCESSING: 'PROCESSING'
};

/**
 * 分散ロックを取得
 */
async function acquireCheckerLock() {
  const redisClient = getRedisClient();
  const lockValue = `${Date.now()}_${Math.random()}`;
  
  const result = await redisClient.set(CHECKER_LOCK_KEY, lockValue, 'PX', LOCK_TTL, 'NX');
  
  return {
    acquired: result === 'OK',
    lockValue,
    release: async () => {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      return await redisClient.eval(script, 1, CHECKER_LOCK_KEY, lockValue);
    }
  };
}

/**
 * チェック状態を取得
 */
async function getCheckerState() {
  const redisClient = getRedisClient();
  const state = await redisClient.get(CHECKER_STATE_KEY);
  return state ? JSON.parse(state) : { state: STATE.OK };
}

/**
 * チェック状態を設定
 */
async function setCheckerState(state, details = null) {
  const redisClient = getRedisClient();
  const stateData = {
    state,
    timestamp: Date.now(),
    details
  };
  await redisClient.set(CHECKER_STATE_KEY, JSON.stringify(stateData));
}

/**
 * BOT管理残高を3つのソースから取得
 * 1. MongoDB取引履歴から再計算
 * 2. Redisサマリーキャッシュ
 * 3. Redisポジションデータ
 */
async function getBotManagedBalanceDetailed(exchangeId) {
  try {
    console.log(`[BALANCE_CHECKER] Calculating detailed BOT managed balance for ${exchangeId}`);
    
    // 1. MongoDB取引履歴から再計算
    const mongoBalances = await calculateBalanceFromMongoDB(exchangeId);
    
    // 2. Redisサマリーから取得
    const redisBalances = await calculateBalanceFromRedisSummary(exchangeId);
    
    // 3. Redisポジションから取得（既存の関数を流用）
    const positionBalances = await getBotManagedBalance();
    
    const snapshot = {
      timestamp: Date.now(),
      exchangeId,
      mongodb: mongoBalances,
      redisSummary: redisBalances,
      redisPositions: positionBalances
    };
    
    console.log(`[BALANCE_CHECKER] Detailed BOT balance calculated: ${exchangeId}`);
    return snapshot;
  } catch (error) {
    console.error(`[BALANCE_CHECKER] Detailed BOT balance error (${exchangeId}):`, error.message);
    throw error;
  }
}

/**
 * MongoDBの取引履歴から残高を再計算
 */
async function calculateBalanceFromMongoDB(exchangeId) {
  const balances = {};
  
  try {
    // 設定から対象シンボルを取得
    const exchangeConfig = config.exchanges[exchangeId];
    if (!exchangeConfig || !exchangeConfig.symbols) {
      return balances;
    }
    
    // 残高チェック対象の戦略を取得（新しいヘルパー関数を使用）
    const strategies = getBalanceCheckEligibleStrategies(config);
    
    for (const symbol of exchangeConfig.symbols) {
      const [baseCurrency] = symbol.split('/');
      
      // 全戦略の合計残高を取得
      let totalBalance = 0;
      
      for (const strategy of strategies) {
        try {
          const position = await getTradeCurrentPosition(exchangeId, symbol, strategy);
          totalBalance += position || 0;
        } catch (error) {
          console.warn(`[BALANCE_CHECKER] Error getting position for ${strategy}:`, error.message);
        }
      }
      
      if (totalBalance > 0) {
        balances[baseCurrency] = (balances[baseCurrency] || 0) + totalBalance;
      }
    }
    
    return balances;
  } catch (error) {
    console.error(`[BALANCE_CHECKER] MongoDB calculation error:`, error.message);
    throw error;
  }
}

/**
 * Redisサマリーから残高を計算
 */
async function calculateBalanceFromRedisSummary(exchangeId) {
  try {
    const summaries = await getAllTradeSummaries();
    const balances = {};
    
    for (const summary of summaries) {
      if (summary.exchange === exchangeId) {
        const [baseCurrency] = summary.symbol.split('/');
        const netPosition = summary.netPosition || 0;
        
        if (netPosition > 0) {
          balances[baseCurrency] = (balances[baseCurrency] || 0) + netPosition;
        }
      }
    }
    
    return balances;
  } catch (error) {
    console.error(`[BALANCE_CHECKER] Redis summary calculation error:`, error.message);
    throw error;
  }
}

/**
 * 堅牢な残高比較（分散ロック付き）
 */
async function compareBalancesRobust(exchangeId) {
  const lock = await acquireCheckerLock();
  
  if (!lock.acquired) {
    console.log(`[BALANCE_CHECKER] Another check is already running, skipping`);
    return { skipped: true, reason: 'another_check_running' };
  }
  
  try {
    console.log(`[BALANCE_CHECKER] Starting robust balance check for ${exchangeId}`);
    
    // 現在の状態を取得
    const currentStateData = await getCheckerState();
    const currentState = currentStateData.state;
    
    // PROCESSING状態に設定
    await setCheckerState(STATE.PROCESSING, { exchangeId, startTime: Date.now() });
    
    // 取引所残高とBOT詳細残高を取得
    const [exchangeBalance, botDetailedBalance] = await Promise.all([
      getExchangeBalance(exchangeId),
      getBotManagedBalanceDetailed(exchangeId)
    ]);
    
    // 詳細比較を実行
    const comparison = await performDetailedComparison(exchangeBalance, botDetailedBalance);
    
    // 結果の判定
    const hasDiscrepancies = comparison.discrepancies.length > 0;
    const hasInternalInconsistencies = comparison.internalInconsistencies.length > 0;
    const hasAnyIssues = hasDiscrepancies || hasInternalInconsistencies;
    
    // 状態遷移の判定
    const newState = hasAnyIssues ? STATE.ERROR : STATE.OK;
    
    // 初回エラー検出または状態変化時のみ通知
    const shouldNotify = (currentState === STATE.OK && newState === STATE.ERROR) ||
                        (currentState === STATE.ERROR && newState === STATE.OK);
    
    if (shouldNotify && hasAnyIssues) {
      const message = createDetailedDiscrepancyMessage(comparison);
      await postOrderToDiscord(message);
      console.error(`[BALANCE_CHECKER] Discrepancies detected for ${exchangeId}:`, comparison);
    } else if (shouldNotify && !hasAnyIssues) {
      const message = `✅ **残高整合性回復**\n取引所: ${exchangeId}\n時刻: ${new Date().toLocaleString('ja-JP')}`;
      await postOrderToDiscord(message);
      console.log(`[BALANCE_CHECKER] Balance consistency restored for ${exchangeId}`);
    }
    
    // 状態を更新
    await setCheckerState(newState, {
      exchangeId,
      lastCheck: Date.now(),
      hasDiscrepancies,
      hasInternalInconsistencies,
      comparison: hasAnyIssues ? comparison : null
    });
    
    return {
      exchangeId,
      success: true,
      hasDiscrepancies,
      hasInternalInconsistencies,
      comparison,
      stateChanged: currentState !== newState
    };
    
  } catch (error) {
    console.error(`[BALANCE_CHECKER] Robust check failed for ${exchangeId}:`, error.message);
    
    // エラー状態に設定
    await setCheckerState(STATE.ERROR, {
      exchangeId,
      error: error.message,
      timestamp: Date.now()
    });
    
    // エラー通知
    const errorMessage = `❌ **残高チェックエラー**\n取引所: ${exchangeId}\nエラー: ${error.message}`;
    await postErrorToDiscord(errorMessage);
    
    throw error;
  } finally {
    await lock.release();
  }
}

/**
 * 残高の詳細比較と分析
 */
async function performDetailedComparison(exchangeSnapshot, botSnapshot) {
  const comparison = {
    timestamp: Date.now(),
    exchangeData: exchangeSnapshot,
    botData: botSnapshot,
    discrepancies: [],
    internalInconsistencies: []
  };
  
  // 取引所残高 vs BOT残高の比較
  const exchangeBalances = exchangeSnapshot.total;
  const mongoBalances = botSnapshot.mongodb;
  const redisBalances = botSnapshot.redisSummary;
  const positionBalances = botSnapshot.redisPositions;
  
  // 全ての通貨を取得
  const allCurrencies = new Set([
    ...Object.keys(exchangeBalances),
    ...Object.keys(mongoBalances),
    ...Object.keys(redisBalances),
    ...Object.keys(positionBalances)
  ]);
  
  for (const currency of allCurrencies) {
    // JPYは除外
    if (currency === 'JPY') continue;
    
    const exchangeAmount = exchangeBalances[currency] || 0;
    const mongoAmount = mongoBalances[currency] || 0;
    const redisAmount = redisBalances[currency] || 0;
    const positionAmount = positionBalances[currency] || 0;
    
    // 有意な残高がある場合のみチェック
    const maxAmount = Math.max(exchangeAmount, mongoAmount, redisAmount, positionAmount);
    if (maxAmount < BALANCE_CONFIG.thresholds.significantBalance) continue;
    
    const currencyComparison = {
      currency,
      exchange: exchangeAmount,
      mongodb: mongoAmount,
      redisSummary: redisAmount,
      redisPositions: positionAmount,
      discrepancies: {}
    };
    
    // 各ソース間の比較
    if (Math.abs(exchangeAmount - mongoAmount) > 0) {
      currencyComparison.discrepancies.exchangeVsMongo = exchangeAmount - mongoAmount;
    }
    
    if (Math.abs(mongoAmount - redisAmount) > 0) {
      currencyComparison.discrepancies.mongoVsRedis = mongoAmount - redisAmount;
      comparison.internalInconsistencies.push({
        currency,
        type: 'mongo_redis_mismatch',
        mongo: mongoAmount,
        redis: redisAmount,
        difference: mongoAmount - redisAmount
      });
    }
    
    if (Math.abs(redisAmount - positionAmount) > 0) {
      currencyComparison.discrepancies.redisVsPosition = redisAmount - positionAmount;
      comparison.internalInconsistencies.push({
        currency,
        type: 'redis_position_mismatch',
        summary: redisAmount,
        positions: positionAmount,
        difference: redisAmount - positionAmount
      });
    }
    
    if (Object.keys(currencyComparison.discrepancies).length > 0) {
      comparison.discrepancies.push(currencyComparison);
    }
  }
  
  return comparison;
}

/**
 * 詳細なDiscordメッセージを作成
 */
function createDetailedDiscrepancyMessage(comparison) {
  const { exchangeData, discrepancies, internalInconsistencies } = comparison;
  
  let message = `🚨 **残高整合性エラー検出**\n`;
  message += `取引所: ${exchangeData.id || 'Unknown'}\n`;
  message += `検出時刻: ${new Date(comparison.timestamp).toLocaleString('ja-JP')}\n\n`;
  
  if (discrepancies.length > 0) {
    message += `**🔍 残高乖離詳細:**\n`;
    const maxCurrencies = BALANCE_CONFIG.notifications.maxCurrenciesToShow;
    for (const disc of discrepancies.slice(0, maxCurrencies)) {
      message += `**${disc.currency}:**\n`;
      message += `  取引所: ${disc.exchange.toFixed(8)}\n`;
      message += `  MongoDB: ${disc.mongodb.toFixed(8)}\n`;
      message += `  Redis: ${disc.redisSummary.toFixed(8)}\n`;
      message += `  ポジション: ${disc.redisPositions.toFixed(8)}\n`;
      
      if (disc.discrepancies.exchangeVsMongo) {
        message += `  ⚠️ 取引所-MongoDB差異: ${disc.discrepancies.exchangeVsMongo.toFixed(8)}\n`;
      }
      message += `\n`;
    }
    
    if (discrepancies.length > maxCurrencies) {
      message += `...他${discrepancies.length - maxCurrencies}通貨でも乖離あり\n\n`;
    }
  }
  
  if (internalInconsistencies.length > 0) {
    message += `**⚠️ 内部データ不整合:**\n`;
    const maxInconsistencies = BALANCE_CONFIG.notifications.maxInconsistenciesToShow;
    for (const inc of internalInconsistencies.slice(0, maxInconsistencies)) {
      message += `  ${inc.currency}: ${inc.type} (差異: ${inc.difference.toFixed(8)})\n`;
    }
    
    if (internalInconsistencies.length > maxInconsistencies) {
      message += `...他${internalInconsistencies.length - maxInconsistencies}件の不整合あり\n`;
    }
    message += `\n`;
  }
  
  message += `**🔧 緊急対応が必要です**`;
  
  return message;
}

/**
 * チェック状態の手動リセット（開発者用）
 */
async function resetCheckerState() {
  await setCheckerState(STATE.OK, { reset: true, timestamp: Date.now() });
  console.log(`[BALANCE_CHECKER] State manually reset to OK`);
}

module.exports = {
  getExchangeBalance,
  getBotManagedBalance,
  compareBalances,
  checkAllExchangeBalances,
  checkSingleExchange,
  // 新しい堅牢な機能
  compareBalancesRobust,
  getBotManagedBalanceDetailed,
  getCheckerState,
  resetCheckerState,
  STATE
};