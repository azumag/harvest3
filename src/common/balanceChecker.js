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
 * APIレート制限管理クラス
 */
class ApiRateLimiter {
  constructor(config) {
    this.config = config;
    this.requestCounts = new Map();
    this.lastCleanup = Date.now();
  }

  async checkRateLimit(exchangeId) {
    if (!this.config.security || !this.config.security.apiRateLimit || !this.config.security.apiRateLimit.enabled) {
      return true;
    }

    const now = Date.now();
    const windowStart = now - 60000; // 1分間のウィンドウ

    // 定期的にカウンターをクリーンアップ
    if (now - this.lastCleanup > 60000) {
      this.cleanup(windowStart);
      this.lastCleanup = now;
    }

    // 現在のリクエスト数を取得
    const requests = this.requestCounts.get(exchangeId) || [];
    const recentRequests = requests.filter(timestamp => timestamp > windowStart);

    // レート制限チェック
    const maxRequests = this.config.security?.apiRateLimit?.maxRequestsPerMinute || 30;
    if (recentRequests.length >= maxRequests) {
      logger.warn(`APIレート制限に達しました (${exchangeId}): ${recentRequests.length} requests/min`);
      return false;
    }

    // リクエストを記録
    recentRequests.push(now);
    this.requestCounts.set(exchangeId, recentRequests);
    return true;
  }

  cleanup(windowStart) {
    for (const [exchangeId, requests] of this.requestCounts.entries()) {
      const filteredRequests = requests.filter(timestamp => timestamp > windowStart);
      if (filteredRequests.length === 0) {
        this.requestCounts.delete(exchangeId);
      } else {
        this.requestCounts.set(exchangeId, filteredRequests);
      }
    }
  }
}

// レート制限インスタンスを作成
const rateLimiter = new ApiRateLimiter(BALANCE_CONFIG);

/**
 * Redis接続を確実に確立する（セキュリティ強化版）
 * @returns {Promise<void>}
 */
async function ensureRedisConnection() {
  const redisClient = getRedisClient();
  
  // 厳密な接続検証が有効な場合の追加チェック
  if (BALANCE_CONFIG.security?.enableStrictRedisValidation) {
    if (redisClient && redisClient.isReady) {
      try {
        // 実際に簡単なコマンドを実行して接続の健全性を確認
        await redisClient.ping();
        logger.debug('Redis接続の健全性確認済み');
        return;
      } catch (error) {
        logger.warn('Redis接続の健全性チェックに失敗、再接続を試行:', error.message);
      }
    }
  } else {
    // 従来の簡易チェック
    if (redisClient && redisClient.isReady) {
      return;
    }
  }
  
  // 接続を試行（リトライ機能付き）
  logger.info('Redis接続を確立中...');
  
  const maxRetries = BALANCE_CONFIG.security?.maxRedisRetryAttempts || 3;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await initRedisClient();
      if (!client || !client.isReady) {
        throw new Error('Redis接続の初期化に失敗しました');
      }
      
      // 厳密な検証が有効な場合、接続テストを実行
      if (BALANCE_CONFIG.security?.enableStrictRedisValidation) {
        await client.ping();
        logger.debug('Redis接続テスト成功');
      }
      
      logger.info('Redis接続が正常に確立されました');
      return;
    } catch (error) {
      lastError = error;
      logger.error(`Redis接続試行 ${attempt}/${maxRetries} 失敗:`, error.message);
      
      if (attempt < maxRetries) {
        const delay = 1000 * attempt; // 指数バックオフ
        logger.info(`${delay}ms 後に再試行します...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(`Redis接続エラー（${maxRetries}回試行後）: ${lastError.message}`);
}

/**
 * 金額データの厳密なバリデーションと解析
 * @param {any} amount - 金額データ
 * @param {string} symbol - 通貨ペア（デバッグ用）
 * @returns {number|null} 有効な金額またはnull
 */
function validateAndParseAmount(amount, symbol) {
  // null/undefined チェック
  if (amount === null || amount === undefined) {
    return null;
  }

  // 文字列の場合の追加チェック
  if (typeof amount === 'string') {
    // 空文字列チェック
    if (amount.trim() === '') {
      return null;
    }
    
    // 数値以外の文字が含まれているかチェック（小数点、負号、科学記法は許可）
    if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(amount.trim())) {
      return null;
    }
  }

  // 数値変換
  const parsed = Number(amount);
  
  // NaN、Infinity、-Infinity チェック
  if (!Number.isFinite(parsed)) {
    return null;
  }

  // 負の値チェック（残高は非負であるべき）
  if (parsed < 0) {
    logger.warn(`負の金額を検出 (${symbol}): ${amount}`);
    return null;
  }

  // 極端に大きい値のチェック（現実的でない値を除外）
  if (parsed > 1e15) {
    logger.warn(`異常に大きい金額を検出 (${symbol}): ${amount}`);
    return null;
  }

  return parsed;
}

/**
 * 取引所残高を取得する
 * @param {string} exchangeId - 取引所ID
 * @returns {Object} 取引所の残高情報
 */
async function getExchangeBalance(exchangeId) {
  try {
    // APIレート制限チェック
    const canProceed = await rateLimiter.checkRateLimit(exchangeId);
    if (!canProceed) {
      const cooldownPeriod = BALANCE_CONFIG.security?.apiRateLimit?.cooldownPeriod || 60000;
      logger.warn(`APIレート制限により待機中 (${exchangeId}): ${cooldownPeriod}ms`);
      await new Promise(resolve => setTimeout(resolve, cooldownPeriod));
      
      // 再度チェック
      const canProceedAfterCooldown = await rateLimiter.checkRateLimit(exchangeId);
      if (!canProceedAfterCooldown) {
        throw new Error(`APIレート制限により処理を中断 (${exchangeId})`);
      }
    }

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

    // 詳細なポジション統計を収集（デバッグレベルでのみ実行）
    if (BALANCE_CONFIG.debug?.enableDetailedLogging) {
      const positionStats = {
        total: allPositions.length,
        byStatus: {},
        bySide: {},
        byExchange: {}
      };

      allPositions.forEach(position => {
        // ステータス別統計
        positionStats.byStatus[position.status] = (positionStats.byStatus[position.status] || 0) + 1;
        // サイド別統計
        positionStats.bySide[position.side] = (positionStats.bySide[position.side] || 0) + 1;
        // 取引所別統計
        positionStats.byExchange[position.exchangeId] = (positionStats.byExchange[position.exchangeId] || 0) + 1;
      });

      logger.debug('ポジション統計:', positionStats);
    }

    // 有効な買いポジションのみを抽出（より厳密な条件）
    const validBuyPositions = allPositions.filter(position => {
      // 基本的な必須フィールドのチェック
      if (!position.symbol || !position.side || !position.amount || !position.status) {
        logger.warn('不完全なポジションデータを除外:', position);
        return false;
      }

      // 買いポジションで、かつ有効なステータスのもの
      return position.side === 'buy' && 
             ['open', 'pending'].includes(position.status) &&
             position.amount > 0;
    });

    // 通貨別に集計
    const currencyBalances = {};
    const processingDetails = [];

    validBuyPositions.forEach(position => {
      try {
        // シンボルから基軸通貨を抽出 (例: BTC/JPY -> BTC)
        const [baseCurrency] = position.symbol.split('/');
        
        if (!baseCurrency) {
          logger.warn('シンボルの解析に失敗:', position.symbol);
          return;
        }

        if (!currencyBalances[baseCurrency]) {
          currencyBalances[baseCurrency] = 0;
        }

        // より厳密な型チェックとバリデーション
        const amount = validateAndParseAmount(position.amount, position.symbol);
        if (amount === null) {
          logger.warn(`無効な金額データをスキップ: ${position.symbol}, amount: ${position.amount}`);
          return;
        }
        currencyBalances[baseCurrency] += amount;
        
        // 処理詳細を記録
        processingDetails.push({
          currency: baseCurrency,
          amount,
          symbol: position.symbol,
          status: position.status,
          exchangeId: position.exchangeId
        });
      } catch (error) {
        logger.error('ポジション処理エラー:', error.message, position);
      }
    });

    // 結果の詳細ログ
    logger.info(`Bot管理残高計算完了: ${Object.keys(currencyBalances).length}通貨, 有効ポジション: ${validBuyPositions.length}/${allPositions.length}`);
    
    // 有意な残高がある通貨のみログ出力
    Object.entries(currencyBalances).forEach(([currency, balance]) => {
      if (balance >= BALANCE_CONFIG.thresholds.significantBalance) {
        logger.info(`${currency}: ${balance.toFixed(8)} (${processingDetails.filter(d => d.currency === currency).length}ポジション)`);
      }
    });

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
  const comparisonStartTime = Date.now();
  
  try {
    logger.info(`残高比較開始: ${exchangeId}`);

    // 取引所残高を取得
    const exchangeBalance = await getExchangeBalance(exchangeId);

    // Bot管理残高を取得
    const botBalance = await getBotManagedBalance();

    // 診断情報を収集
    const diagnosticInfo = {
      exchangeId,
      timestamp: comparisonStartTime,
      exchangeBalanceKeys: Object.keys(exchangeBalance.total || {}),
      botBalanceKeys: Object.keys(botBalance || {}),
      exchangeTotal: exchangeBalance.total || {},
      botTotal: botBalance || {}
    };

    // 比較対象の通貨一覧（両方に存在する通貨 + 一定額以上の通貨）
    const significantThreshold = BALANCE_CONFIG.thresholds.significantBalance;
    const exchangeCurrencies = Object.keys(exchangeBalance.total || {}).filter(
      currency => (exchangeBalance.total[currency] || 0) >= significantThreshold
    );
    const botCurrencies = Object.keys(botBalance || {});
    const allCurrencies = [...new Set([...exchangeCurrencies, ...botCurrencies])];

    const discrepancies = [];
    const processedCurrencies = new Set(); // 重複処理防止用

    logger.debug(`残高比較対象通貨 (${exchangeId}): ${allCurrencies.length}通貨 - ${allCurrencies.join(', ')}`);

    // 並行処理の設定に基づいて処理方法を決定
    if (BALANCE_CONFIG.parallelProcessing?.enableCurrencyParallelProcessing && allCurrencies.length > 5) {
      // 並行処理で通貨を処理
      const processCurrency = async (currency) => {
        // JPYは残高チェックから除外
        if (currency === 'JPY') {
          return null;
        }

        // 重複処理の防止
        if (processedCurrencies.has(currency)) {
          logger.warn(`通貨の重複処理を検出しスキップ (${exchangeId}): ${currency}`);
          return null;
        }
        processedCurrencies.add(currency);

        const exchangeAmount = exchangeBalance.total[currency] || 0;
        const botAmount = botBalance[currency] || 0;

        // 有意な差がある場合のみチェック
        if (Math.max(exchangeAmount, botAmount) < significantThreshold) {
          return null;
        }

        // 差異の計算（完全一致チェック）
        const difference = Math.abs(exchangeAmount - botAmount);
        const maxAmount = Math.max(exchangeAmount, botAmount);
        const discrepancyPercent = maxAmount > 0 ? (difference / maxAmount) * 100 : 0;

        // 完全一致でない場合は全て通知（閾値0%）
        if (difference > 0) {
          return {
            currency,
            exchangeAmount,
            botAmount,
            difference,
            discrepancyPercent: Math.round(discrepancyPercent * 100) / 100,
            timestamp: Date.now(),
            exchangeId
          };
        }
        return null;
      };

      // バッチ処理で並行度を制限
      const batchSize = BALANCE_CONFIG.parallelProcessing?.currencyBatchSize || 10;
      const processingDelay = BALANCE_CONFIG.parallelProcessing?.processingDelay || 100;
      
      for (let i = 0; i < allCurrencies.length; i += batchSize) {
        const batch = allCurrencies.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(processCurrency));
        
        // 結果をdiscrepanciesに追加
        results.forEach(result => {
          if (result) {
            // 重複チェック
            const existingDiscrepancy = discrepancies.find(disc => disc.currency === result.currency);
            if (!existingDiscrepancy) {
              discrepancies.push(result);
              logger.debug(`不整合エントリ追加 (${exchangeId}): ${result.currency} - 差異=${result.difference}`);
            }
          }
        });

        // バッチ間の遅延（Discord制限考慮）
        if (i + batchSize < allCurrencies.length) {
          await new Promise(resolve => setTimeout(resolve, processingDelay));
        }
      }
    } else {
      // 従来の逐次処理
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
      
      const message = createEnhancedDiscrepancyMessage(exchangeId, uniqueDiscrepancies, diagnosticInfo);
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
      isHealthy: discrepancies.length === 0,
      diagnosticInfo
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
 * 拡張された不整合メッセージを作成する（診断情報付き）
 * @param {string} exchangeId - 取引所ID
 * @param {Array} discrepancies - 不整合データ
 * @param {Object} diagnosticInfo - 診断情報
 * @returns {string} Discord用メッセージ
 */
function createEnhancedDiscrepancyMessage(exchangeId, discrepancies, diagnosticInfo) {
  let message = `🚨 **残高不整合検出** (${exchangeId})\n`;
  message += `検出時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n\n`;

  // 上位N件の不整合を表示（設定から取得）
  const maxDisplay = BALANCE_CONFIG.notifications?.maxDiscrepancyDisplay || 5;
  const displayDiscrepancies = discrepancies.slice(0, maxDisplay);
  
  displayDiscrepancies.forEach(disc => {
    message += `**${disc.currency}**\n`;
    message += `・取引所残高: ${disc.exchangeAmount.toFixed(8)}\n`;
    message += `・Bot管理残高: ${disc.botAmount.toFixed(8)}\n`;
    message += `・差異: ${disc.difference.toFixed(8)} (${disc.discrepancyPercent}%)\n\n`;
  });

  if (discrepancies.length > maxDisplay) {
    message += `...他 ${discrepancies.length - maxDisplay} 件の不整合\n\n`;
  }

  // 診断情報を追加
  if (diagnosticInfo) {
    message += `**🔍 診断情報:**\n`;
    message += `・取引所通貨数: ${diagnosticInfo.exchangeBalanceKeys.length}\n`;
    message += `・Bot管理通貨数: ${diagnosticInfo.botBalanceKeys.length}\n`;
    
    // 高い不整合率の通貨を強調
    const highDiscrepancies = discrepancies.filter(d => d.discrepancyPercent > 50);
    if (highDiscrepancies.length > 0) {
      message += `・高不整合率通貨: ${highDiscrepancies.map(d => `${d.currency}(${d.discrepancyPercent}%)`).join(', ')}\n`;
    }
    message += '\n';
  }

  message += '⚠️ **緊急対応が必要です。**\n';
  message += '詳細な調査とRedisデータの確認を行ってください。';

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