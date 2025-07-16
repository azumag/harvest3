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

// 定数定義
const DECIMAL_PRECISION = 8;
const EXCLUDED_CURRENCIES = ['JPY'];

/**
 * 通貨名を正規化する
 * @param {string} currency - 通貨名
 * @returns {string} 正規化された通貨名（トリム + 大文字）
 */
function normalizeCurrency(currency) {
  return currency.trim().toUpperCase();
}

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

    // 詳細なポジション統計を収集
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

    // 全ポジションの統計情報を詳細に収集
    const statusBreakdown = {};
    const sideBreakdown = {};
    const validationIssues = [];

    allPositions.forEach(position => {
      // ステータス別統計
      statusBreakdown[position.status || 'undefined'] = (statusBreakdown[position.status || 'undefined'] || 0) + 1;
      // サイド別統計
      sideBreakdown[position.side || 'undefined'] = (sideBreakdown[position.side || 'undefined'] || 0) + 1;
      
      // データ検証
      if (!position.symbol || !position.side || !position.amount || !position.status) {
        validationIssues.push({
          issue: 'missing_fields',
          position: {
            symbol: position.symbol || 'missing',
            side: position.side || 'missing',
            amount: position.amount || 'missing',
            status: position.status || 'missing'
          }
        });
      }
    });

    // 詳細な統計情報をログ出力
    logger.info('ポジション詳細統計:');
    logger.info(`  総ポジション数: ${allPositions.length}`);
    logger.info(`  ステータス別: ${JSON.stringify(statusBreakdown, null, 2)}`);
    logger.info(`  サイド別: ${JSON.stringify(sideBreakdown, null, 2)}`);
    
    if (validationIssues.length > 0) {
      logger.warn(`データ検証エラー: ${validationIssues.length}件`);
      validationIssues.slice(0, 5).forEach((issue, index) => {
        logger.warn(`  [${index + 1}] ${issue.issue}: ${JSON.stringify(issue.position)}`);
      });
    }

    // 有効な買いポジションのみを抽出（より厳密な条件）
    const validBuyPositions = allPositions.filter(position => {
      // 基本的な必須フィールドのチェック
      if (!position.symbol || !position.side || !position.amount || !position.status) {
        logger.warn('不完全なポジションデータを除外:', position);
        return false;
      }

      // 買いポジションで、かつ有効なステータスのもの
      // 'open' と 'pending' 以外のステータスも考慮する
      const validStatuses = ['open', 'pending', 'active', 'opened', 'running'];
      const isValidStatus = validStatuses.includes(position.status);
      const isClosedStatus = position.status === 'closed';
      
      if (position.side === 'buy' && !isValidStatus && !isClosedStatus) {
        logger.warn(`未知のステータスを持つ買いポジション: ${position.status} (${position.symbol})`);
        // 未知のステータスでも買いポジションは残高計算に含める（保守的なアプローチ）
        return position.amount > 0;
      }
      
      return position.side === 'buy' && 
             isValidStatus &&
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

        const amount = parseFloat(position.amount) || 0;
        currencyBalances[baseCurrency] += amount;
        
        // 処理詳細を記録（開発環境のみ）
        if (process.env.NODE_ENV === 'development') {
          processingDetails.push({
            currency: baseCurrency,
            amount,
            symbol: position.symbol,
            status: position.status,
            exchangeId: position.exchangeId
          });
        }
      } catch (error) {
        logger.error('ポジション処理エラー:', error.message, position);
      }
    });

    // 結果の詳細ログ
    logger.info(`Bot管理残高計算完了: ${Object.keys(currencyBalances).length}通貨, 有効ポジション: ${validBuyPositions.length}/${allPositions.length}`);
    
    // 除外されたポジションの統計（効率的な処理のためSetを使用）
    const excludedPositions = allPositions.length - validBuyPositions.length;
    if (excludedPositions > 0) {
      logger.info(`除外されたポジション: ${excludedPositions}件`);
      const excludedByStatus = {};
      const excludedBySide = {};
      const validPositionSet = new Set(validBuyPositions);
      
      allPositions.forEach(position => {
        if (!validPositionSet.has(position)) {
          excludedByStatus[position.status || 'undefined'] = (excludedByStatus[position.status || 'undefined'] || 0) + 1;
          excludedBySide[position.side || 'undefined'] = (excludedBySide[position.side || 'undefined'] || 0) + 1;
        }
      });
      
      logger.info(`  除外理由 - ステータス別: ${JSON.stringify(excludedByStatus, null, 2)}`);
      logger.info(`  除外理由 - サイド別: ${JSON.stringify(excludedBySide, null, 2)}`);
    }
    
    // 有意な残高がある通貨のみログ出力
    Object.entries(currencyBalances).forEach(([currency, balance]) => {
      if (balance >= BALANCE_CONFIG.thresholds.significantBalance) {
        const positionCount = process.env.NODE_ENV === 'development' 
          ? processingDetails.filter(d => d.currency === currency).length
          : validBuyPositions.filter(p => p.symbol.split('/')[0] === currency).length;
        logger.info(`${currency}: ${balance.toFixed(8)} (${positionCount}ポジション)`);
      }
    });
    
    // 残高ゼロの通貨について追加情報を提供
    if (Object.keys(currencyBalances).length === 0) {
      logger.warn('Bot管理残高が0の状態です。以下の可能性があります:');
      logger.warn('  1. 全ポジションが決済済み (status="closed")');
      logger.warn('  2. 売りポジションのみが存在');
      logger.warn('  3. データベース接続またはデータ整合性の問題');
      logger.warn('  4. ポジションデータの形式変更');
    }

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
 * 比較対象の通貨一覧を取得する
 * @param {Object} exchangeBalance - 取引所残高
 * @param {Object} botBalance - Bot管理残高
 * @returns {Array} 比較対象の通貨一覧
 */
function getComparisonCurrencies(exchangeBalance, botBalance) {
  const significantThreshold = BALANCE_CONFIG.thresholds.significantBalance;
  const exchangeCurrencies = Object.keys(exchangeBalance.total || {}).filter(
    currency => (exchangeBalance.total[currency] || 0) >= significantThreshold
  );
  const botCurrencies = Object.keys(botBalance || {});
  return [...new Set([...exchangeCurrencies, ...botCurrencies])];
}

/**
 * 残高の不整合を検出する
 * @param {Array} allCurrencies - 比較対象の通貨一覧
 * @param {Object} exchangeBalance - 取引所残高
 * @param {Object} botBalance - Bot管理残高
 * @param {string} exchangeId - 取引所ID
 * @returns {Array} 不整合データの配列
 */
function detectDiscrepancies(allCurrencies, exchangeBalance, botBalance, exchangeId) {
  const discrepancies = [];
  const processedCurrencies = new Set();
  const significantThreshold = BALANCE_CONFIG.thresholds.significantBalance;
  let skippedDuplicateCount = 0;

  logger.debug(`不整合検出開始 (${exchangeId}): 対象通貨数=${allCurrencies.length}`);

  for (const currency of allCurrencies) {
    // 除外する通貨をチェック
    if (EXCLUDED_CURRENCIES.includes(currency)) {
      continue;
    }

    // 通貨名の正規化
    const normalizedCurrency = normalizeCurrency(currency);

    // 重複処理の防止
    if (processedCurrencies.has(normalizedCurrency)) {
      skippedDuplicateCount++;
      logger.warn(`通貨の重複処理を検出しスキップ (${exchangeId}): ${currency} -> ${normalizedCurrency}`);
      continue;
    }
    processedCurrencies.add(normalizedCurrency);

    const exchangeAmount = exchangeBalance.total[currency] || 0;
    const botAmount = botBalance[currency] || 0;

    // 有意な差がある場合のみチェック
    if (Math.max(exchangeAmount, botAmount) < significantThreshold) {
      continue;
    }

    // 差異の計算（浮動小数点精度問題の修正）
    const difference = Math.abs(parseFloat((exchangeAmount - botAmount).toFixed(DECIMAL_PRECISION)));
    const maxAmount = Math.max(exchangeAmount, botAmount);
    const discrepancyPercent = maxAmount > 0 ? parseFloat(((difference / maxAmount) * 100).toFixed(2)) : 0;

    // 許容誤差の計算（通貨固有 > 全体設定の順で適用）
    const currencyTolerance = BALANCE_CONFIG.thresholds.currencySpecificTolerance[normalizedCurrency];
    const tolerancePercent = currencyTolerance !== undefined 
      ? currencyTolerance 
      : BALANCE_CONFIG.thresholds.balanceComparisonTolerance;

    // 許容誤差を超えた場合のみ通知
    if (discrepancyPercent > tolerancePercent) {
      const discrepancyEntry = {
        currency: normalizedCurrency,
        originalCurrency: currency, // 元の通貨名を保持
        exchangeAmount: parseFloat(exchangeAmount.toFixed(DECIMAL_PRECISION)),
        botAmount: parseFloat(botAmount.toFixed(DECIMAL_PRECISION)),
        difference,
        discrepancyPercent,
        tolerancePercent,
        isExternalTradeSuspected: discrepancyPercent >= BALANCE_CONFIG.thresholds.externalTradeThreshold,
        timestamp: Date.now(),
        exchangeId
      };
      
      discrepancies.push(discrepancyEntry);
      logger.debug(`不整合エントリ追加 (${exchangeId}): ${normalizedCurrency} - 差異=${difference}`);
    }
  }

  // 検出処理の統計情報をログ出力
  logger.debug(`不整合検出完了 (${exchangeId}): 検出件数=${discrepancies.length}, 重複スキップ=${skippedDuplicateCount}, 処理済み通貨=${processedCurrencies.size}`);
  
  return discrepancies;
}

/**
 * 不整合データから重複を除去する（強化版）
 * @param {Array} discrepancies - 不整合データの配列
 * @param {string} exchangeId - 取引所ID
 * @returns {Array} 重複を除去した不整合データの配列
 */
function removeDuplicateDiscrepancies(discrepancies, exchangeId) {
  const uniqueDiscrepancies = [];
  const seenCurrencies = new Map(); // Set から Map に変更して詳細情報を保持
  let duplicateCount = 0;
  
  for (const disc of discrepancies) {
    const normalizedDiscCurrency = normalizeCurrency(disc.currency);
    
    if (!seenCurrencies.has(normalizedDiscCurrency)) {
      const enhancedDisc = {
        ...disc,
        currency: normalizedDiscCurrency,
        originalCurrency: disc.originalCurrency || disc.currency, // 既存のoriginalCurrencyを優先
        processedAt: Date.now() // 処理時刻を記録
      };
      uniqueDiscrepancies.push(enhancedDisc);
      seenCurrencies.set(normalizedDiscCurrency, {
        index: uniqueDiscrepancies.length - 1,
        originalCurrency: disc.currency,
        processedAt: enhancedDisc.processedAt
      });
    } else {
      duplicateCount++;
      const existingInfo = seenCurrencies.get(normalizedDiscCurrency);
      logger.warn(`最終段階で重複エントリを検出し除去 (${exchangeId}): ${disc.currency} -> ${normalizedDiscCurrency} (既存: ${existingInfo.originalCurrency}, インデックス: ${existingInfo.index})`);
    }
  }
  
  // 重複が検出された場合は統計情報をログ出力
  if (duplicateCount > 0) {
    logger.warn(`重複エントリ除去統計 (${exchangeId}): 元の件数=${discrepancies.length}, 重複除去後=${uniqueDiscrepancies.length}, 除去された重複=${duplicateCount}`);
  }
  
  // 最終的な一意性チェック
  const finalCheck = new Set(uniqueDiscrepancies.map(d => d.currency));
  if (finalCheck.size !== uniqueDiscrepancies.length) {
    logger.error(`重複除去後も重複が残存 (${exchangeId}): 期待数=${finalCheck.size}, 実際数=${uniqueDiscrepancies.length}`);
    // 緊急対応として完全重複除去を実行
    const emergencyUnique = Array.from(finalCheck).map(currency => 
      uniqueDiscrepancies.find(d => d.currency === currency)
    );
    logger.warn(`緊急重複除去を実行 (${exchangeId}): ${uniqueDiscrepancies.length} -> ${emergencyUnique.length}`);
    return emergencyUnique;
  }
  
  return uniqueDiscrepancies;
}

/**
 * 不整合データを処理し、Discord通知を送信する
 * @param {Array} discrepancies - 不整合データの配列
 * @param {string} exchangeId - 取引所ID
 * @param {Object} diagnosticInfo - 診断情報
 * @returns {Array} 処理された不整合データの配列
 */
async function processDiscrepancies(discrepancies, exchangeId, diagnosticInfo) {
  if (discrepancies.length === 0) {
    logger.info(`残高チェック正常: ${exchangeId}`);
    return discrepancies;
  }

  // 重複を除去
  const uniqueDiscrepancies = removeDuplicateDiscrepancies(discrepancies, exchangeId);
  
  // Discord通知を送信
  const message = createEnhancedDiscrepancyMessage(exchangeId, uniqueDiscrepancies, diagnosticInfo);
  await postOrderToDiscord(message);
  
  // 不整合の重要度に応じてログレベルを決定
  const highDiscrepancyThreshold = BALANCE_CONFIG.thresholds.highDiscrepancyPercent;
  const externalTradeThreshold = BALANCE_CONFIG.thresholds.externalTradeThreshold;
  
  const highDiscrepancies = uniqueDiscrepancies.filter(disc => 
    disc.discrepancyPercent >= highDiscrepancyThreshold
  );
  const externalTradeDiscrepancies = uniqueDiscrepancies.filter(disc => 
    disc.isExternalTradeSuspected
  );

  let logLevel, severityText;
  
  // 全ての不整合が外部取引の可能性が高い場合（50%以上）は情報レベルで扱う
  if (externalTradeDiscrepancies.length === uniqueDiscrepancies.length && 
      externalTradeDiscrepancies.length > 0) {
    logLevel = 'info';
    severityText = '外部取引による残高差異';
  } else if (highDiscrepancies.length > 0) {
    logLevel = 'error';
    severityText = externalTradeDiscrepancies.length > 0 
      ? '高度不整合（外部取引の可能性含む）' 
      : '高度不整合';
  } else {
    logLevel = 'warn';
    severityText = externalTradeDiscrepancies.length > 0 
      ? '軽微な不整合（外部取引の可能性）' 
      : '軽微な不整合';
  }
  
  const message_text = `残高不整合検出: ${exchangeId} (${uniqueDiscrepancies.length}件の${severityText})`;
  logger[logLevel](message_text);
  
  // ログ出力時の強化された重複防止チェック
  const loggedCurrencies = new Map(); // Set から Map に変更
  const logEntries = [];
  
  uniqueDiscrepancies.forEach((disc, index) => {
    const normalizedCurrency = normalizeCurrency(disc.currency);
    const logIndex = index + 1;
    
    if (!loggedCurrencies.has(normalizedCurrency)) {
      const toleranceInfo = disc.tolerancePercent > 0 ? ` [許容誤差: ${disc.tolerancePercent}%]` : '';
      const externalTradeInfo = disc.isExternalTradeSuspected ? ' ⚠️外部取引の可能性' : '';
      const logEntry = `  [${logIndex}] ${normalizedCurrency}: 取引所=${disc.exchangeAmount}, Bot=${disc.botAmount}, 差異=${disc.difference} (${disc.discrepancyPercent}%)${toleranceInfo}${externalTradeInfo}`;
      logEntries.push(logEntry);
      loggedCurrencies.set(normalizedCurrency, {
        logIndex,
        originalCurrency: disc.originalCurrency || disc.currency,
        processedAt: disc.processedAt || Date.now()
      });
    } else {
      const existingInfo = loggedCurrencies.get(normalizedCurrency);
      logger.warn(`ログ出力時に重複を検出しスキップ (${exchangeId}): ${disc.currency} -> ${normalizedCurrency} (既存ログ: [${existingInfo.logIndex}], 元通貨: ${existingInfo.originalCurrency})`);
    }
  });
  
  // 実際のログ出力（重複なしが保証された状態）
  logEntries.forEach(logEntry => {
    logger[logLevel](logEntry);
  });
  
  // 最終検証: ログ出力数と期待数の一致確認
  if (logEntries.length !== loggedCurrencies.size) {
    logger.error(`ログ出力数不整合 (${exchangeId}): 出力数=${logEntries.length}, 通貨数=${loggedCurrencies.size}`);
  }
  
  // デバッグ用の詳細データ（開発環境のみ、機密情報をマスク）
  if (process.env.NODE_ENV === 'development') {
    try {
      const maskedDiscrepancies = uniqueDiscrepancies.map(disc => ({
        currency: disc.currency,
        exchangeAmount: '***',
        botAmount: '***',
        difference: '***',
        discrepancyPercent: disc.discrepancyPercent,
        timestamp: disc.timestamp,
        exchangeId: disc.exchangeId
      }));
      const discrepanciesJson = JSON.stringify(maskedDiscrepancies, null, 2);
      logger.debug(`残高不整合詳細データ (${exchangeId}):`, discrepanciesJson);
    } catch (jsonError) {
      logger.error(`残高データのJSON化に失敗 (${exchangeId}):`, jsonError.message);
      logger.error(`不整合オブジェクトの構造情報: 件数=${uniqueDiscrepancies.length}, type=${typeof uniqueDiscrepancies}`);
    }
  }
  
  return uniqueDiscrepancies;
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

    // 比較対象の通貨一覧を取得
    const allCurrencies = getComparisonCurrencies(exchangeBalance, botBalance);

    logger.debug(`残高比較対象通貨 (${exchangeId}): ${allCurrencies.length}通貨 - ${allCurrencies.join(', ')}`);

    // 不整合を検出
    const discrepancies = detectDiscrepancies(allCurrencies, exchangeBalance, botBalance, exchangeId);

    // 不整合を処理
    const processedDiscrepancies = await processDiscrepancies(discrepancies, exchangeId, diagnosticInfo);

    return {
      exchangeId,
      discrepancies: processedDiscrepancies,
      isHealthy: processedDiscrepancies.length === 0,
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
    message += `・取引所残高: ${disc.exchangeAmount.toFixed(DECIMAL_PRECISION)}\n`;
    message += `・Bot管理残高: ${disc.botAmount.toFixed(DECIMAL_PRECISION)}\n`;
    message += `・差異: ${disc.difference.toFixed(DECIMAL_PRECISION)} (${disc.discrepancyPercent}%)\n\n`;
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
  // 外部取引の可能性に応じてメッセージのトーンを調整
  const externalTradeDiscrepancies = discrepancies.filter(d => d.isExternalTradeSuspected);
  const isAllExternalTrade = externalTradeDiscrepancies.length === discrepancies.length && discrepancies.length > 0;
  
  let messageHeader, messageIcon;
  if (isAllExternalTrade) {
    messageIcon = '💡';
    messageHeader = '外部取引による残高差異検出';
  } else {
    messageIcon = '🚨';
    messageHeader = '残高不整合検出';
  }
  
  let message = `${messageIcon} **${messageHeader}** (${exchangeId})\n`;
  message += `検出時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n\n`;

  // 上位5件の不整合を表示
  const maxDisplay = 5;
  const displayDiscrepancies = discrepancies.slice(0, maxDisplay);
  
  displayDiscrepancies.forEach(disc => {
    const externalTradeWarning = disc.isExternalTradeSuspected ? ' ⚠️' : '';
    message += `**${disc.currency}${externalTradeWarning}**\n`;
    message += `・取引所残高: ${disc.exchangeAmount.toFixed(DECIMAL_PRECISION)}\n`;
    message += `・Bot管理残高: ${disc.botAmount.toFixed(DECIMAL_PRECISION)}\n`;
    message += `・差異: ${disc.difference.toFixed(DECIMAL_PRECISION)} (${disc.discrepancyPercent}%)\n`;
    if (disc.tolerancePercent > 0) {
      message += `・許容誤差: ${disc.tolerancePercent}%\n`;
    }
    if (disc.isExternalTradeSuspected) {
      message += `・⚠️ 外部取引の可能性が高い差異です\n`;
    }
    message += '\n';
  });

  if (discrepancies.length > maxDisplay) {
    message += `...他 ${discrepancies.length - maxDisplay} 件の不整合\n\n`;
  }

  // 診断情報を追加
  if (diagnosticInfo) {
    message += `**🔍 診断情報:**\n`;
    message += `・取引所通貨数: ${diagnosticInfo.exchangeBalanceKeys.length}\n`;
    message += `・Bot管理通貨数: ${diagnosticInfo.botBalanceKeys.length}\n`;
    
    // 外部取引の可能性がある通貨を表示
    const externalTradeDiscrepancies = discrepancies.filter(d => d.isExternalTradeSuspected);
    if (externalTradeDiscrepancies.length > 0) {
      message += `・外部取引の可能性: ${externalTradeDiscrepancies.map(d => `${d.currency}(${d.discrepancyPercent}%)`).join(', ')}\n`;
    }
    
    // 高い不整合率の通貨を強調
    const highDiscrepancies = discrepancies.filter(d => d.discrepancyPercent > 50);
    if (highDiscrepancies.length > 0) {
      message += `・高不整合率通貨: ${highDiscrepancies.map(d => `${d.currency}(${d.discrepancyPercent}%)`).join(', ')}\n`;
    }
    message += '\n';
  }

  // 外部取引の可能性に応じて対応メッセージを調整
  if (externalTradeDiscrepancies.length === discrepancies.length) {
    // 全て外部取引の可能性
    message += '💡 **外部取引が原因の可能性があります。**\n';
    message += '取引所での手動取引履歴を確認し、必要に応じてボット設定を調整してください。';
  } else if (externalTradeDiscrepancies.length > 0) {
    // 一部が外部取引の可能性
    message += '⚠️ **調査が必要です。**\n';
    message += '外部取引の可能性がある通貨とシステム不整合の可能性がある通貨が混在しています。詳細な調査とRedisデータの確認を行ってください。';
  } else {
    // 外部取引ではない可能性が高い
    message += '🚨 **緊急対応が必要です。**\n';
    message += 'システム不整合の可能性が高いです。詳細な調査とRedisデータの確認を行ってください。';
  }

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