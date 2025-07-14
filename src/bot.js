// モジュールのインポート
const { config } = require('./config');
const { SETTINGS } = require('./config/settings');
const { postErrorToDiscord, postOrderToDiscord } = require('./common/notifications');
const { getValidatedConfig } = require('./common/balanceCheckerConfig');
const { unifiedErrorHandler } = require('./common/errorHandler');
const { globalStrategyCache } = require('./common/dataCache');
const Logger = require('./hft/utils/Logger');
const logger = new Logger('Bot');
const {
  initializeDB,
  updateFilledTrades,
  fetchTicker,
  getSymbolsByExchange,
  getStrategyConfig,
  getMarketParametersByExchangeSymbol,
  cleanupInvalidPendingOrders
} = require('./database/manager');
const { getAllPendingOrdersRedis } = require('./database/redisDatabase');
const PendingOrderLimitManager = require('./common/pendingOrderLimitManager');
const OrderValidation = require('./common/orderValidation');
const {
  checkStopLoss,
  executeStopLoss,
  checkPositionLimits,
  checkDrawdown
} = require('./strategies/utils/riskManagement');
const { getAllPositionsRedis } = require('./database/redisDatabase');
const { POSITION_CONTROL_CONSTANTS } = require('./common/const');

// 未約定注文クリーンアップの最終実行時間を記録
const lastCleanupTime = {}; // exchangeId -> timestamp

// 包括的未約定注文管理システム
const globalOrderManagers = {}; // exchangeId -> PendingOrderLimitManager
const globalOrderValidators = {}; // exchangeId -> OrderValidation

// 包括的クリーンアップの実行間隔
const COMPREHENSIVE_CLEANUP_INTERVAL = SETTINGS.MONITORING.COMPREHENSIVE_CLEANUP_INTERVAL;
const lastComprehensiveCleanupTime = 0;

// 自己修復システムの実行間隔
const SELF_HEALING_INTERVAL = SETTINGS.MONITORING.SELF_HEALING_INTERVAL;
const lastSelfHealingTime = 0;

// 残高整合性チェック設定を取得
const BALANCE_CONFIG = getValidatedConfig();
const BALANCE_CHECK_INTERVAL = BALANCE_CONFIG.intervals.lightweightCheck;
const lastBalanceCheckTime = 0;
const lastRobustBalanceCheckTime = 0;

/**
 * 強化版未約定注文クリーンアップ機能
 * 事前統計とエラーハンドリングを含む包括的なクリーンアップ
 */
async function enhancedPendingOrderCleanup(exchangeInstance, exchangeId, verbose = false) {
  const startTime = Date.now();
  const result = {
    success: false,
    preStats: null,
    cleanupResult: null,
    processingTime: 0,
    error: null
  };

  try {
    // 事前統計の取得
    const allOrders = await getAllPendingOrdersRedis();
    const exchangeOrders = allOrders.filter(order => order.exchangeId === exchangeId);

    const preStats = {
      total: exchangeOrders.length,
      bySymbol: {},
      byStrategy: {},
      byStatus: {},
      oldestOrder: null,
      newestOrder: null
    };

    let oldestTimestamp = Infinity;
    let newestTimestamp = 0;

    for (const order of exchangeOrders) {
      // シンボル別統計
      preStats.bySymbol[order.symbol] = (preStats.bySymbol[order.symbol] || 0) + 1;

      // 戦略別統計
      preStats.byStrategy[order.strategyKey] = (preStats.byStrategy[order.strategyKey] || 0) + 1;

      // ステータス別統計
      preStats.byStatus[order.status] = (preStats.byStatus[order.status] || 0) + 1;

      // 最古・最新の注文を追跡
      if (order.timestamp < oldestTimestamp) {
        oldestTimestamp = order.timestamp;
        preStats.oldestOrder = order;
      }
      if (order.timestamp > newestTimestamp) {
        newestTimestamp = order.timestamp;
        preStats.newestOrder = order;
      }
    }

    result.preStats = preStats;

    // 詳細ログ出力（冗長モード時）
    if (verbose && preStats.total > 0) {
      logger.debug(`[強化クリーンアップ] ${exchangeId} 事前統計:`);
      logger.debug(`  総未約定注文: ${preStats.total}件`);

      // シンボル別統計（上位5件）
      const topSymbols = Object.entries(preStats.bySymbol)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      if (topSymbols.length > 0) {
        logger.debug(`  主要シンボル: ${topSymbols.map(([symbol, count]) => `${symbol}(${count})`).join(', ')}`);
      }

      // 最古の注文情報
      if (preStats.oldestOrder) {
        const oldestAge = Math.floor((Date.now() - preStats.oldestOrder.timestamp) / (1000 * 60 * 60));
        logger.info(`  最古注文: ${preStats.oldestOrder.orderId} (${oldestAge}時間前)`);
      }
    }

    // 既存のクリーンアップ機能を実行
    const cleanupResult = await cleanupInvalidPendingOrders(exchangeInstance);
    result.cleanupResult = cleanupResult;

    // 処理時間の計算
    result.processingTime = Date.now() - startTime;

    // 成功時の詳細ログ
    if (cleanupResult.deleted > 0) {
      logger.info(`[強化クリーンアップ] ${exchangeId} 完了: ${cleanupResult.deleted}件削除 (処理時間: ${result.processingTime}ms)`);

      // 重要なクリーンアップ結果をDiscordに通知
      if (cleanupResult.deleted >= 5) {
        let message = `🧹 **未約定注文クリーンアップ** (${exchangeId})\n` +
                     '━━━━━━━━━━━━━━━━━━━━━━━\n' +
                     '📊 **処理結果**\n' +
                     `　チェック: ${cleanupResult.checked}件\n` +
                     `　削除: ${cleanupResult.deleted}件\n` +
                     `　エラー: ${cleanupResult.errors}件\n`;

        if (preStats.total > 0) {
          message += '\n📈 **事前統計**\n' +
                    `　総未約定注文: ${preStats.total}件\n`;

          // 上位シンボルを表示
          const topSymbols = Object.entries(preStats.bySymbol)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
          if (topSymbols.length > 0) {
            message += `　主要シンボル: ${topSymbols.map(([symbol, count]) => `${symbol}(${count})`).join(', ')}\n`;
          }
        }

        message += `\n⏱️ 処理時間: ${result.processingTime}ms\n`;
        message += `⏰ ${new Date().toLocaleString('ja-JP')}`;

        await postOrderToDiscord(message);
      }
    } else if (verbose) {
      logger.info(`[強化クリーンアップ] ${exchangeId} 完了: クリーンアップ対象なし (処理時間: ${result.processingTime}ms)`);
    }

    result.success = true;
    return result;

  } catch (error) {
    result.error = error.message;
    result.processingTime = Date.now() - startTime;
    logger.warn(`[強化クリーンアップ] ${exchangeId} エラー: ${error.message} (処理時間: ${result.processingTime}ms)`);
    return result;
  }
}

const args = process.argv.slice(2);
const hasArgs = args.length > 0;
// 通貨ペア（シンボル）の取得
let targetSymbol = null;
const symbolArgIndex = args.findIndex(arg => arg === '--symbol' || arg === '-s');
if (symbolArgIndex !== -1 && symbolArgIndex + 1 < args.length) {
  targetSymbol = args[symbolArgIndex + 1];
  // 引数リストから削除（後続の処理に影響しないように）
  args.splice(symbolArgIndex, 2);
}

if (args.includes('--help') || args.includes('-h')) {
  logger.info('オプション:');
  logger.info('  --xxxxx(戦略名）で atomicExec が指定されている戦略を単一実行');
  logger.info('  --symbol, -s [シンボル]  特定の通貨ペア（例：BTC/JPY）のみを処理');
  logger.info('  --help, -h        このヘルプメッセージを表示');
  logger.info('オプションなしで実行すると、atomicExec 以外の戦略全てを実行');
  process.exit(0);
}

/**
 * 効率的な戦略実行エンジン（スロットリング対応版）
 * CCXTスロットルキュー問題を解決するため、API呼び出しを分散して実行
 */
async function executeStrategyCycle() {
  try {
    const { globalStrategyExecutionManager } = require('./common/strategyExecutionManager');
    const { globalAPIDataCache } = require('./common/apiDataCache');
    
    logger.info('[戦略実行] スロットリング対応版戦略実行サイクル開始');
    
    // マーケットパラメータの更新
    const symbolsByExchange = await getSymbolsByExchange(config);
    const marketParametersByExchange = await getMarketParametersByExchangeSymbol(symbolsByExchange, config, { targetSymbol });

    // すべての取引所とシンボルの組み合わせを作成
    const allExchangeSymbolPairs = [];
    for (const exchangeId in symbolsByExchange) {
      for (const symbol of symbolsByExchange[exchangeId]) {
        // シンボルが指定されている場合、一致するもののみ処理
        if (targetSymbol && symbol !== targetSymbol) {
          continue;
        }
        allExchangeSymbolPairs.push({
          exchangeId,
          symbol,
          marketParameters: marketParametersByExchange[exchangeId][symbol]
        });
      }
    }

    // 戦略実行前のメンテナンス処理を実行（従来通り、しかし分散実行）
    await executeMaintenance(allExchangeSymbolPairs);
    
    // 新しいスロットリング対応戦略実行システムを使用
    logger.info(`[戦略実行] ${allExchangeSymbolPairs.length}ペアの分散実行を開始`);
    await globalStrategyExecutionManager.scheduleStrategyExecution(allExchangeSymbolPairs, config);
    
    // 実行統計をログ出力
    const cacheStats = globalAPIDataCache.getStats();
    logger.info(`[戦略実行] サイクル完了 - API効率: ${cacheStats.hitRate} (${cacheStats.hits}H/${cacheStats.misses}M)`);

  } catch (error) {
    const errorMessage = `[戦略実行] エラーが発生しました: ${error.message}`;
    logger.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  }
}

/**
 * メンテナンス処理（未約定注文クリーンアップ等）を分散実行
 */
async function executeMaintenance(allExchangeSymbolPairs) {
  const processedExchanges = new Set();
  
  for (const { exchangeId, symbol } of allExchangeSymbolPairs) {
    if (processedExchanges.has(exchangeId)) {
      continue; // 取引所ごとに1回のみ実行
    }
    processedExchanges.add(exchangeId);
    
    const exchangeConfig = config.exchanges[exchangeId];
    if (!exchangeConfig) {
      continue;
    }

    const exchangeInstance = exchangeConfig.instance;
    logger.info(`[メンテナンス] 開始: ${exchangeId}`);

    try {
      // 約定済み取引の更新（最初のシンボルのみで代表実行）
      const firstSymbol = allExchangeSymbolPairs.find(p => p.exchangeId === exchangeId)?.symbol;
      if (firstSymbol) {
        await updateFilledTrades(exchangeInstance, firstSymbol);
      }

      // 包括的未約定注文管理システムの初期化
      if (!globalOrderManagers[exchangeId]) {
        const redis = require('redis');
        const redisClient = redis.createClient({
          url: process.env.REDIS_URL || 'redis://localhost:6379'
        });
        await redisClient.connect();

        globalOrderManagers[exchangeId] = new PendingOrderLimitManager(exchangeInstance, redisClient);
        globalOrderValidators[exchangeId] = new OrderValidation(exchangeInstance);

        logger.info(`[注文管理] 初期化完了: ${exchangeId}`);
      }

      // 強化版未約定注文クリーンアップ（5分間隔）
      const now = Date.now();
      const cleanupInterval = 5 * 60 * 1000; // 5分
      const lastTime = lastCleanupTime[exchangeId] || 0;

      if (now - lastTime >= cleanupInterval) {
        try {
          logger.info(`[強化クリーンアップ] 開始: ${exchangeId}`);
          const enhancedResult = await enhancedPendingOrderCleanup(exchangeInstance, exchangeId, false);
          lastCleanupTime[exchangeId] = now;

          if (enhancedResult.success && enhancedResult.cleanupResult.deleted > 0) {
            logger.info(`[強化クリーンアップ] 成功: ${exchangeId} - ${enhancedResult.cleanupResult.deleted}件削除`);
          } else if (!enhancedResult.success) {
            logger.warn(`[強化クリーンアップ] 失敗: ${exchangeId} - ${enhancedResult.error}`);
          }
        } catch (cleanupError) {
          logger.warn(`[強化クリーンアップ] エラー: ${exchangeId} - ${cleanupError.message}`);
        }
      }

      // 包括的未約定注文管理（10分間隔）
      if (now - lastComprehensiveCleanupTime >= COMPREHENSIVE_CLEANUP_INTERVAL) {
        try {
          logger.info(`[包括管理] 開始: ${exchangeId}`);
          const orderManager = globalOrderManagers[exchangeId];

          if (orderManager) {
            // ヘルスチェック実行
            const health = await orderManager.healthCheck();
            logger.info(`[包括管理] ヘルス: ${health.status} (利用率: ${health.utilization}, 買い比率: ${health.buyRatio})`);

            // 制限違反の確認
            const violations = await orderManager.detectLimitViolations();

            if (violations.length > 0) {
              const highPriorityViolations = violations.filter(v => v.severity === 'high');

              if (highPriorityViolations.length > 0) {
                logger.info(`[包括管理] 緊急対応必要: ${highPriorityViolations.length}件の高優先度違反`);

                // 自動修復実行
                const remediationResult = await orderManager.performAutoCleanup();
                logger.info(`[包括管理] 自動修復完了: ${remediationResult.cleaned}件削除`);

                // Discord通知（詳細版）
                if (remediationResult.cleaned > 0) {
                  // TODO: Discord通知処理を実装
                }
              } else {
                logger.info(`[包括管理] 中優先度違反: ${violations.length}件 - 監視継続`);
              }
            } else {
              logger.info('[包括管理] 正常: 制限違反なし');
            }
          }
        } catch (comprehensiveError) {
          logger.warn(`[包括管理] エラー: ${exchangeId} - ${comprehensiveError.message}`);
        }
      }
    } catch (error) {
      logger.warn(`[メンテナンス] エラー: ${exchangeId} - ${error.message}`);
    }
  }
}

/**
 * イベント駆動型ボット起動関数
 * レビュー対応: SchedulingManagerによる効率的スケジューリング
 */
async function startBot() {
  const MAX_STARTUP_RETRIES = 3;
  const STARTUP_RETRY_DELAY = 10000; // 10秒
  
  for (let attempt = 1; attempt <= MAX_STARTUP_RETRIES; attempt++) {
    try {
      logger.info(`[システム] ボット起動開始 (試行 ${attempt}/${MAX_STARTUP_RETRIES})...`);
      
      // データベース初期化（エラーハンドリング強化）
      logger.info('[システム] データベース初期化を開始します...');
      await initializeDB();
      logger.info('[システム] データベース初期化が完了しました ✓');
      
      // コマンドライン引数があるかどうかをチェック
      logger.info(`コマンドライン引数: ${hasArgs ? '指定あり' : '指定なし'}`);
      if (targetSymbol) {
        logger.info(`指定された通貨ペア: ${targetSymbol}`);
      }

      logger.info('\n[システム] イベント駆動型ボット開始...');

      // 効率的な戦略実行スケジューリング（固定間隔を排除）
      schedulingManager.scheduleIntervalTask('strategy-execution', async () => {
        try {
          await executeStrategyCycle();
        } catch (strategyError) {
          logger.error('戦略実行サイクルエラー:', strategyError.message);
          await postErrorToDiscord(`戦略実行サイクル失敗: ${strategyError.message}`);
        }
      }, 1, { // 1分間隔をベースに動的調整
        description: '効率的戦略実行エンジン（動的間隔調整）'
      });

      // 初回実行（即座に開始）
      logger.info('[システム] 初回戦略実行を開始します...');
      setTimeout(async () => {
        try {
          await executeStrategyCycle();
          logger.info('[システム] 初回戦略実行が完了しました ✓');
        } catch (error) {
          logger.error('初回戦略実行エラー:', error.message);
          await postErrorToDiscord(`初回戦略実行失敗: ${error.message}`);
        }
      }, 5000); // 5秒後に初回実行

      logger.info('\n[システム] イベント駆動型ボット起動完了 - while(true)ループを排除');
      logger.info('[システム] プロセスは継続実行中... (Ctrl+C で停止)');

      // プロセスの継続（以前の while(true) を置き換え）
      await new Promise(() => {}); // 無限待機（イベント駆動）

    } catch (error) {
      const errorMessage = `ボット起動エラー (試行 ${attempt}/${MAX_STARTUP_RETRIES}): ${error.message}`;
      logger.error(errorMessage, error);
      
      if (attempt === MAX_STARTUP_RETRIES) {
        // 最終試行でも失敗した場合
        const finalErrorMessage = `ボット起動が${MAX_STARTUP_RETRIES}回失敗しました: ${error.message}`;
        logger.error(finalErrorMessage);
        await postErrorToDiscord(finalErrorMessage);
        process.exit(1);
      }
      
      // 再試行前の待機
      logger.info(`[システム] ${STARTUP_RETRY_DELAY}ms後に再試行します...`);
      await new Promise(resolve => setTimeout(resolve, STARTUP_RETRY_DELAY));
    }
  }
}

/**
 * リスク管理チェックを実行する関数
 * ストップロス、トレーリングストップ、タイムストップの処理を行う
 */
async function executeRiskManagementCheck() {
  try {
    // 積極的なクリーンアップを実行（リスク管理前）
    logger.info('[リスク管理] 事前クリーンアップ開始...');
    let preCleanupCount = 0;

    // 取引所別に事前クリーンアップを実行（強化版）
    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (!exchangeConfig) {
        continue;
      }
      try {
        const enhancedResult = await enhancedPendingOrderCleanup(exchangeConfig.instance, exchangeId, true);
        if (enhancedResult.success && enhancedResult.cleanupResult) {
          preCleanupCount += enhancedResult.cleanupResult.deleted;
        }
      } catch (cleanupError) {
        logger.warn(`[リスク管理] 事前強化クリーンアップエラー ${exchangeId}: ${cleanupError.message}`);
      }
    }

    if (preCleanupCount > 0) {
      logger.info(`[リスク管理] 事前クリーンアップ完了: ${preCleanupCount}件削除`);
    }

    // 全ポジションを取得
    const allPositions = await getAllPositionsRedis();

    if (allPositions.length === 0) {
      logger.info('[リスク管理] チェック対象のポジションがありません');
      return;
    }

    logger.info(`[リスク管理] ${allPositions.length}個のポジションをチェック中...`);

    // 不整合ポジションの事前検出と修復
    let preRepairCount = 0;
    const validPositions = [];

    for (const position of allPositions) {
      try {
        // 基本的な整合性チェック
        if (!position.amount || position.amount <= 0 ||
            !position.entryPrice || position.entryPrice <= 0 ||
            !position.symbol || !position.exchangeId) {
          logger.warn(`[リスク管理] 無効なポジションデータ: ${position.key || 'unknown'}`);

          // 無効なポジションを削除
          try {
            const { closeAndCleanupPosition } = require('./database/redisDatabase');
            await closeAndCleanupPosition(position.key);
            preRepairCount++;
            logger.info(`[リスク管理] 無効ポジション削除: ${position.key}`);
          } catch (deleteError) {
            logger.error(`[リスク管理] 無効ポジション削除失敗: ${position.key} - ${deleteError.message}`);
          }
          continue;
        }

        validPositions.push(position);
      } catch (validationError) {
        logger.warn(`[リスク管理] ポジション検証エラー: ${position.key || 'unknown'} - ${validationError.message}`);
      }
    }

    if (preRepairCount > 0) {
      logger.info(`[リスク管理] 事前修復完了: ${preRepairCount}件の無効ポジションを削除`);
    }

    let processedCount = 0;
    let stoppedCount = 0;
    let errorCount = 0;

    // 有効なポジションに対してリスク管理を実行
    for (const position of validPositions) {
      try {
        processedCount++;

        // 取引所インスタンスを取得
        const exchangeConfig = config.exchanges[position.exchangeId];
        if (!exchangeConfig) {
          logger.warn(`[リスク管理] 取引所設定が見つかりません: ${position.exchangeId}`);
          errorCount++;
          continue;
        }

        const exchangeInstance = exchangeConfig.instance;

        // 現在価格を取得
        const ticker = await fetchTicker(exchangeInstance, position.symbol);
        if (!ticker || !ticker.last) {
          logger.warn(`[リスク管理] 価格情報取得失敗: ${position.symbol} @ ${position.exchangeId}`);
          errorCount++;
          continue;
        }

        const currentPrice = ticker.last;

        // ストップロス条件をチェック
        const stopLossResult = await checkStopLoss(exchangeInstance, position.symbol, position.strategyKey, currentPrice);

        if (stopLossResult.shouldStop) {
          logger.info(`[リスク管理] ストップロス発動: ${position.symbol} @ ${position.exchangeId}`);
          logger.info(`  エントリー価格: ${position.entryPrice}`);
          logger.info(`  現在価格: ${currentPrice}`);
          logger.info(`  損失: ${stopLossResult.lossAmount} JPY (${stopLossResult.lossPercentage.toFixed(2)}%)`);

          try {
            // マーケットパラメータを取得
            const marketParameters = await getMarketParametersByExchangeSymbol(
              { [position.exchangeId]: [position.symbol] }, 
              config
            );
            const marketParams = marketParameters[position.exchangeId][position.symbol];
            
            await executeStopLoss(exchangeInstance, position.symbol, position.strategyKey, position, marketParams);
            stoppedCount++;
            logger.info(`[リスク管理] ストップロス実行完了: ${position.symbol}`);
          } catch (stopLossError) {
            logger.error(`[リスク管理] ストップロス実行失敗: ${position.symbol} - ${stopLossError.message}`);
            errorCount++;
          }
          continue;
        }

        // ポジション制限チェック
        const positionLimitResult = await checkPositionLimits(exchangeInstance, position.symbol, position.strategyKey);
        if (positionLimitResult.shouldClose) {
          logger.info(`[リスク管理] ポジション制限超過: ${position.symbol} @ ${position.exchangeId}`);
          logger.info(`  理由: ${positionLimitResult.reason}`);

          try {
            // マーケットパラメータを取得
            const marketParameters = await getMarketParametersByExchangeSymbol(
              { [position.exchangeId]: [position.symbol] }, 
              config
            );
            const marketParams = marketParameters[position.exchangeId][position.symbol];
            
            await executeStopLoss(exchangeInstance, position.symbol, position.strategyKey, position, marketParams);
            stoppedCount++;
            logger.info(`[リスク管理] ポジション制限クローズ完了: ${position.symbol}`);
          } catch (limitCloseError) {
            logger.error(`[リスク管理] ポジション制限クローズ失敗: ${position.symbol} - ${limitCloseError.message}`);
            errorCount++;
          }
          continue;
        }

        // ドローダウンチェック
        try {
          const drawdownResult = await checkDrawdown(exchangeInstance, position.strategyKey);
          if (drawdownResult.daily.exceeded || drawdownResult.weekly.exceeded || drawdownResult.monthly.exceeded) {
            logger.warn(`[リスク管理] ドローダウン警告: 日次=${drawdownResult.daily.loss.toFixed(2)}% 週次=${drawdownResult.weekly.loss.toFixed(2)}% 月次=${drawdownResult.monthly.loss.toFixed(2)}%`);
            
            // 制限を超えている場合、このポジションをクローズ
            logger.info(`[リスク管理] ドローダウン制御: ${position.symbol} をクローズ`);

            try {
              // マーケットパラメータを取得
              const marketParameters = await getMarketParametersByExchangeSymbol(
                { [position.exchangeId]: [position.symbol] }, 
                config
              );
              const marketParams = marketParameters[position.exchangeId][position.symbol];
              
              await executeStopLoss(exchangeInstance, position.symbol, position.strategyKey, position, marketParams);
              stoppedCount++;
              logger.info(`[リスク管理] ドローダウン制御完了: ${position.symbol}`);
            } catch (drawdownCloseError) {
              logger.error(`[リスク管理] ドローダウン制御失敗: ${position.symbol} - ${drawdownCloseError.message}`);
              errorCount++;
            }
          }
        } catch (drawdownCheckError) {
          logger.warn(`[リスク管理] ドローダウンチェックエラー: ${drawdownCheckError.message}`);
        }

      } catch (error) {
        logger.error(`[リスク管理] ポジション処理エラー: ${position.symbol} @ ${position.exchangeId} - ${error.message}`);
        errorCount++;
      }
    }

    // 結果のサマリー
    logger.info(`[リスク管理] チェック完了: 処理 ${processedCount}件, 停止 ${stoppedCount}件, エラー ${errorCount}件`);

    // 重要な結果をDiscordに通知
    if (stoppedCount > 0 || errorCount > 0) {
      const message = `🛡️ **リスク管理実行結果**\n` +
                     '━━━━━━━━━━━━━━━━━━━━━━━\n' +
                     '📊 **処理結果**\n' +
                     `　チェック対象: ${allPositions.length}ポジション\n` +
                     `　有効ポジション: ${validPositions.length}件\n` +
                     `　停止実行: ${stoppedCount}件\n` +
                     `　事前修復: ${preRepairCount}件\n` +
                     `　エラー: ${errorCount}件\n` +
                     `⏰ ${new Date().toLocaleString('ja-JP')}`;

      await postOrderToDiscord(message);
    }

  } catch (error) {
    const errorMessage = `[リスク管理] システムエラー: ${error.message}`;
    logger.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
    throw error;
  }
}

/**
 * 戦略実行用のRunStrategy関数
 * @param {Object} strategy - 実行する戦略
 * @param {Object} exchange - 取引所の設定
 * @param {string} symbol - 通貨ペア
 * @param {string} strategyKey - 戦略キー
 * @param {Object} marketParametersBySymbol - 通貨ペアごとの市場パラメータ
 * @param {Object} options - オプションオブジェクト
 */
async function runStrategy(strategy, exchange, symbol, strategyKey, marketParametersBySymbol, options) {
  try {
    const { allExchangeSymbolPairs, config, strategyConfig } = options;

    // 戦略関数を呼び出し
    await strategy.function(exchange, symbol, strategyConfig, {
      allExchangeSymbolPairs,
      config,
      marketParameters: marketParametersBySymbol
    });

  } catch (error) {
    logger.error(`戦略実行エラー: ${strategyKey} - ${symbol} @ ${exchange.id}`, error);
    throw error;
  }
}

/**
 * 堅牢な残高チェックの実行関数
 */
async function executeRobustBalanceCheck() {
  try {
    logger.info('[堅牢残高チェック] 開始...');

    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (!exchangeConfig) {
        continue;
      }

      try {
        const { compareBalances } = require('./common/balanceChecker');
        const result = await compareBalances(exchangeId);

        if (result.discrepancies.length > 0) {
          logger.warn(`[堅牢残高チェック] ${exchangeId} 不整合検出: ${result.discrepancies.length}件`);

          // 重大な不整合をDiscordに通知
          const severeDiscrepancies = result.discrepancies.filter(d => Math.abs(d.discrepancyPercent) >= 15);
          if (severeDiscrepancies.length > 0) {
            let message = `⚠️ **重大な残高不整合検出** (${exchangeId})\n` +
                         '━━━━━━━━━━━━━━━━━━━━━━━\n' +
                         `📊 **重大不整合**: ${severeDiscrepancies.length}件\n\n`;

            severeDiscrepancies.forEach(d => {
              message += `💱 **${d.currency}**\n` +
                        `　Bot計算: ${d.botAmount.toFixed(6)}\n` +
                        `　取引所: ${d.exchangeAmount.toFixed(6)}\n` +
                        `　差異: ${d.discrepancyPercent.toFixed(2)}%\n\n`;
            });

            message += `⏰ ${new Date().toLocaleString('ja-JP')}`;
            await postErrorToDiscord(message);
          }
        } else {
          logger.info(`[堅牢残高チェック] ${exchangeId} 正常`);
        }
      } catch (balanceError) {
        logger.error(`[堅牢残高チェック] ${exchangeId} エラー:`, balanceError.message);
      }
    }

  } catch (error) {
    const errorMessage = `堅牢残高チェック失敗: ${error.message}`;
    logger.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  }
}

/**
 * 改善されたスケジューリングシステム
 * geminiレビュー対応: node-cronによる宣言的スケジューリング実装
 */
const { getSchedulingManager } = require('./common/schedulingManager');
const { getMaintenanceScheduler } = require('./common/maintenanceScheduler');

// スケジューリングマネージャーの初期化（テスト環境では無効）
let schedulingManager;
let maintenanceScheduler;

if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  schedulingManager = getSchedulingManager();
  maintenanceScheduler = getMaintenanceScheduler();

  // リスク管理チェックを15分間隔でスケジュール
  schedulingManager.scheduleIntervalTask('risk-management', async () => {
    try {
      await executeRiskManagementCheck();
    } catch (error) {
      logger.error('スケジュール済みリスク管理チェックエラー:', error.message);
      await postErrorToDiscord(`リスク管理チェック失敗: ${error.message}`);
    }
  }, 15, {
    description: 'リスク管理チェック（15分間隔）'
  });

  // 堅牢な残高チェックを1時間間隔でスケジュール
  schedulingManager.scheduleIntervalTask('robust-balance-check', async () => {
    try {
      await executeRobustBalanceCheck();
    } catch (error) {
      logger.error('スケジュール済み堅牢残高チェックエラー:', error.message);
      await postErrorToDiscord(`堅牢残高チェック失敗: ${error.message}`);
    }
  }, 60, {
    description: '堅牢残高チェック（1時間間隔）'
  });

  // 自動メンテナンスシステムの初期化
  logger.info('\n[メンテナンス] 自動メンテナンスシステムを初期化しています...');
  maintenanceScheduler.initializeSchedules();
} else {
  // テスト環境用のダミーオブジェクト
  schedulingManager = {
    scheduleIntervalTask: () => {},
    scheduleCustomTask: () => {},
    removeTask: () => {},
    removeAllTasks: () => {},
    getActiveTasks: () => [],
    initializeSchedules: () => {}
  };
  
  maintenanceScheduler = {
    initializeSchedules: () => {}
  };
}

// 優雅なシャットダウンハンドラー（テスト環境では無効）
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  process.on('SIGTERM', () => {
    logger.info('\n[システム] SIGTERM受信 - 優雅なシャットダウンを開始...');
    schedulingManager.removeAllTasks();
    logger.info('[システム] 全スケジュールタスクを停止しました');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('\n[システム] SIGINT受信 (Ctrl+C) - 優雅なシャットダウンを開始...');
    schedulingManager.removeAllTasks();
    logger.info('[システム] 全スケジュールタスクを停止しました');
    process.exit(0);
  });
}

// ボットを起動（テスト環境では自動起動しない）
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  startBot();
}

// 初回リスク管理チェックをスケジュール（起動から30秒後）（テスト環境では無効）
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  schedulingManager.scheduleCustomTask('initial-risk-check', '*/30 * * * * *', async () => {
    try {
      logger.info('=== 初回リスク管理チェック開始 ===');
      await executeRiskManagementCheck();
      logger.info('=== 初回リスク管理チェック完了 ===');

      // 一度だけ実行するためタスクを削除
      schedulingManager.removeTask('initial-risk-check');
    } catch (error) {
      logger.error('初回リスク管理チェックエラー:', error.message);
      await postErrorToDiscord(`初回リスク管理チェック失敗: ${error.message}`);
      schedulingManager.removeTask('initial-risk-check');
    }
  }, {
    description: '初回リスク管理チェック（30秒後実行）'
  });
}