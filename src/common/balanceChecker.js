/**
 * 残高チェッカー - 取引所残高とbot管理残高の比較・監視
 */
const { config } = require('../config');
const { getValidatedConfig } = require('./balanceCheckerConfig');
const { postErrorToDiscord, postOrderToDiscord } = require('./notifications');
const {
  getClient: getRedisClient,
  getAllPositionsRedis
} = require('../database/redisDatabase');
const { initRedisClient } = require('../database/redisClient');
const Logger = require('../hft/utils/Logger');

const logger = new Logger('BalanceChecker');
const { withBitbankErrorHandling } = require('./bitbankErrorHandler');

// 設定の取得
const BALANCE_CONFIG = getValidatedConfig();

/**
 * Redis接続を確実に確立する
 * @returns {Promise<void>}
 */
async function ensureRedisConnection() {
  const redisClient = getRedisClient();
  
  // 既に接続済みの場合は何もしない
  if (redisClient && redisClient.isReady) {
    return;
  }
  
  // 接続を試行
  logger.info('Redis接続を確立中...');
  
  try {
    const client = await initRedisClient();
    if (!client || !client.isReady) {
      throw new Error('Redis接続の初期化に失敗しました');
    }
    
    logger.info('Redis接続が正常に確立されました');
  } catch (error) {
    logger.error('Redis接続の確立に失敗:', error.message);
    throw new Error(`Redis接続エラー: ${error.message}`);
  }
}

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

    // withBitbankErrorHandlingを使用してAPI呼び出しを実行
    const balance = await withBitbankErrorHandling(
      () => exchange.fetchBalance(),
      exchangeId,
      'fetchBalance'
    );

    logger.info(`取引所残高取得完了: ${exchangeId}`);
    return balance;
  } catch (error) {
    logger.error(`取引所残高取得エラー (${exchangeId}):`, error.message);
    throw error;
  }
}

/**
 * botで管理している未売却ポジションから計算した残高を取得する
 * @returns {Object} 通貨別の未売却ポジション残高
 */
async function getBotManagedBalance() {
  try {
    // Redis接続状態を確認し、必要に応じて初期化
    await ensureRedisConnection();

    // Redisから全ポジションを取得
    const allPositions = await getAllPositionsRedis();

    // Redis接続問題でデータが取得できない場合のチェック
    if (!Array.isArray(allPositions)) {
      throw new Error('Redisからポジションデータを取得できませんでした（データ形式エラー）');
    }

    // ポジションデータが空の場合の詳細ログ
    if (allPositions.length === 0) {
      const redisClient = getRedisClient();
      const isConnected = redisClient && redisClient.isReady;
      
      if (!isConnected) {
        throw new Error('Redis接続が確立されていないため、ポジションデータを取得できません');
      }
      
      // Redis接続はあるがデータが空の場合は正常な状態として扱う
      logger.warn('Redis接続は正常ですが、ポジションデータが存在しません（新規起動またはポジションなし）');
    }

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

    logger.info(`Bot管理残高計算完了: ${Object.keys(currencyBalances).length}通貨, 有効ポジション: ${buyPositions.length}/${allPositions.length}`, currencyBalances);
    return currencyBalances;
  } catch (error) {
    logger.error('Bot管理残高取得エラー:', error.message);
    
    // Redis接続エラーの場合は詳細情報を追加
    const redisClient = getRedisClient();
    const redisStatus = redisClient ? (redisClient.isReady ? '接続済み' : '未接続') : 'null';
    logger.error(`Redis状態: ${redisStatus}`);
    
    throw error;
  }
}

/**
 * 残高を比較し、不整合があればDiscordに通知する
 * @param {string} exchangeId - 取引所ID
 * @param {number} thresholdPercent - 許容誤差（パーセント）- 完全一致チェックのため0
 */
async function compareBalances(exchangeId, _thresholdPercent = 0) {
  try {
    logger.info(`残高比較開始: ${exchangeId}`);

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
    const processedCurrencies = new Set(); // 重複処理防止用

    logger.debug(`残高比較対象通貨 (${exchangeId}): ${allCurrencies.length}通貨 - ${allCurrencies.join(', ')}`);

    for (const currency of allCurrencies) {
      // JPYは残高チェックから除外
      if (currency === 'JPY') {
        continue;
      }

      // 重複処理の防止
      if (processedCurrencies.has(currency)) {
        logger.warn(`通貨の重複処理を検出しスキップ (${exchangeId}): ${currency}`);
        continue;
      }
      processedCurrencies.add(currency);

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
        // discrepancies配列での重複チェック（追加の安全措置）
        const existingDiscrepancy = discrepancies.find(disc => disc.currency === currency);
        if (existingDiscrepancy) {
          logger.warn(`discrepancies配列で重複検出しスキップ (${exchangeId}): ${currency} - 既存エントリ: ${JSON.stringify(existingDiscrepancy)}`);
          continue;
        }

        const discrepancyEntry = {
          currency,
          exchangeAmount,
          botAmount,
          difference,
          discrepancyPercent: Math.round(discrepancyPercent * 100) / 100,
          timestamp: Date.now(),
          exchangeId
        };
        
        discrepancies.push(discrepancyEntry);
        logger.debug(`不整合エントリ追加 (${exchangeId}): ${currency} - 差異=${difference}`);
      }
    }

    // 不整合があればDiscordに通知
    if (discrepancies.length > 0) {
      // 最終的な重複チェック（念のため）
      const uniqueDiscrepancies = [];
      const seenCurrencies = new Set();
      
      for (const disc of discrepancies) {
        if (!seenCurrencies.has(disc.currency)) {
          uniqueDiscrepancies.push(disc);
          seenCurrencies.add(disc.currency);
        } else {
          logger.warn(`最終段階で重複エントリを検出し除去 (${exchangeId}): ${disc.currency}`);
        }
      }
      
      const message = createDiscrepancyMessage(exchangeId, uniqueDiscrepancies);
      await postOrderToDiscord(message);
      
      // 不整合の重要度に応じてログレベルを決定（Issue #1108の修正）
      const highDiscrepancyThreshold = BALANCE_CONFIG.thresholds.highDiscrepancyPercent;
      const isHighDiscrepancy = uniqueDiscrepancies.some(disc => 
        disc.discrepancyPercent >= highDiscrepancyThreshold
      );

      const logLevel = isHighDiscrepancy ? 'error' : 'warn';
      const severityText = isHighDiscrepancy ? '高度不整合' : '軽微な不整合';
      
      const message_text = `残高不整合検出: ${exchangeId} (${uniqueDiscrepancies.length}件の${severityText})`;
      logger[logLevel](message_text);
      
      uniqueDiscrepancies.forEach((disc, index) => {
        logger[logLevel](`  [${index + 1}] ${disc.currency}: 取引所=${disc.exchangeAmount}, Bot=${disc.botAmount}, 差異=${disc.difference} (${disc.discrepancyPercent}%)`);
      });
      
      // 元の配列を修正されたものに置き換え
      discrepancies.length = 0;
      discrepancies.push(...uniqueDiscrepancies);
      
      // デバッグ用の詳細データ（JSONとして安全に出力）
      try {
        const discrepanciesJson = JSON.stringify(discrepancies, null, 2);
        logger.debug(`残高不整合詳細データ (${exchangeId}):`, discrepanciesJson);
      } catch (jsonError) {
        logger.error(`残高データのJSON化に失敗 (${exchangeId}):`, jsonError.message);
        logger.error(`不整合オブジェクトの構造情報: 件数=${discrepancies.length}, type=${typeof discrepancies}`);
      }
    } else {
      logger.info(`残高チェック正常: ${exchangeId}`);
    }

    return {
      exchangeId,
      discrepancies,
      isHealthy: discrepancies.length === 0
    };

  } catch (error) {
    let errorMessage = `残高比較エラー (${exchangeId}): ${error.message}`;
    
    // Redis接続エラーの場合は特別な処理
    if (error.message.includes('Redis')) {
      errorMessage = `🔌 Redis接続エラー (${exchangeId}): ${error.message}\n⚠️ strategy-runnerサービスとRedisサービス間の接続を確認してください`;
      logger.error(`Redis接続問題を検出 - Docker環境の確認が必要: ${error.message}`);
    }
    
    logger.error(errorMessage);
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
    logger.info('=== 全取引所残高チェック開始 ===');

    const results = [];
    const exchangeIds = Object.keys(config.exchanges);

    for (const exchangeId of exchangeIds) {
      try {
        const result = await compareBalances(exchangeId);
        results.push(result);

        // 各取引所チェック間の待機（設定から取得）
        await new Promise(resolve => setTimeout(resolve, BALANCE_CONFIG.intervals.exchangeCheckDelay));
      } catch (error) {
        logger.error(`${exchangeId} の残高チェックに失敗:`, error.message);
        results.push({
          exchangeId,
          error: error.message,
          isHealthy: false
        });
      }
    }

    logger.info('=== 全取引所残高チェック完了 ===');
    return results;

  } catch (error) {
    const errorMessage = `全取引所残高チェックエラー: ${error.message}`;
    logger.error(errorMessage);
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
    logger.error(`checkSingleExchange error for ${exchangeId}:`, error.message);
    throw error;
  }
}

module.exports = {
  getExchangeBalance,
  getBotManagedBalance,
  compareBalances,
  checkAllExchangeBalances,
  checkSingleExchange,
  // Redis接続管理
  ensureRedisConnection
};