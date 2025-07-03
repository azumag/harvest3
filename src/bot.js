// モジュールのインポート
const { config } = require('./config');
const { postErrorToDiscord, postOrderToDiscord } = require('./common/notifications');
const { checkAllExchangeBalances } = require('./common/balanceChecker');
const { getValidatedConfig } = require('./common/balanceCheckerConfig');
const { errorHandler } = require('./common/errorHandler');
const { sleep } = require('./common/utils');
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
const { pro } = require('ccxt');

// 未約定注文クリーンアップの最終実行時間を記録
let lastCleanupTime = {}; // exchangeId -> timestamp

// 包括的未約定注文管理システム
let globalOrderManagers = {}; // exchangeId -> PendingOrderLimitManager
let globalOrderValidators = {}; // exchangeId -> OrderValidation

// 包括的クリーンアップの実行間隔 (10分)
const COMPREHENSIVE_CLEANUP_INTERVAL = 10 * 60 * 1000;
let lastComprehensiveCleanupTime = 0;

// 自己修復システムの実行間隔 (30分)
const SELF_HEALING_INTERVAL = 30 * 60 * 1000;
let lastSelfHealingTime = 0;

// 残高整合性チェック設定を取得
const BALANCE_CONFIG = getValidatedConfig();
const BALANCE_CHECK_INTERVAL = BALANCE_CONFIG.intervals.lightweightCheck;
let lastBalanceCheckTime = 0;
let lastRobustBalanceCheckTime = 0;

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
      console.log(`[強化クリーンアップ] ${exchangeId} 事前統計:`);
      console.log(`  総未約定注文: ${preStats.total}件`);
      
      // シンボル別統計（上位5件）
      const topSymbols = Object.entries(preStats.bySymbol)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      if (topSymbols.length > 0) {
        console.log(`  主要シンボル: ${topSymbols.map(([symbol, count]) => `${symbol}(${count})`).join(', ')}`);
      }

      // 最古の注文情報
      if (preStats.oldestOrder) {
        const oldestAge = Math.floor((Date.now() - preStats.oldestOrder.timestamp) / (1000 * 60 * 60));
        console.log(`  最古注文: ${preStats.oldestOrder.orderId} (${oldestAge}時間前)`);
      }
    }

    // 既存のクリーンアップ機能を実行
    const cleanupResult = await cleanupInvalidPendingOrders(exchangeInstance);
    result.cleanupResult = cleanupResult;

    // 処理時間の計算
    result.processingTime = Date.now() - startTime;

    // 成功時の詳細ログ
    if (cleanupResult.deleted > 0) {
      console.log(`[強化クリーンアップ] ${exchangeId} 完了: ${cleanupResult.deleted}件削除 (処理時間: ${result.processingTime}ms)`);
      
      // 重要なクリーンアップ結果をDiscordに通知
      if (cleanupResult.deleted >= 5) {
        let message = `🧹 **未約定注文クリーンアップ** (${exchangeId})\n` +
                     `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                     `📊 **処理結果**\n` +
                     `　チェック: ${cleanupResult.checked}件\n` +
                     `　削除: ${cleanupResult.deleted}件\n` +
                     `　エラー: ${cleanupResult.errors}件\n`;

        if (preStats.total > 0) {
          message += `\n📈 **事前統計**\n` +
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
      console.log(`[強化クリーンアップ] ${exchangeId} 完了: クリーンアップ対象なし (処理時間: ${result.processingTime}ms)`);
    }

    result.success = true;
    return result;

  } catch (error) {
    result.error = error.message;
    result.processingTime = Date.now() - startTime;
    console.warn(`[強化クリーンアップ] ${exchangeId} エラー: ${error.message} (処理時間: ${result.processingTime}ms)`);
    return result;
  }
}

const args = process.argv.slice(2);
// 通貨ペア（シンボル）の取得
let targetSymbol = null;
const symbolArgIndex = args.findIndex(arg => arg === '--symbol' || arg === '-s');
if (symbolArgIndex !== -1 && symbolArgIndex + 1 < args.length) {
  targetSymbol = args[symbolArgIndex + 1];
  // 引数リストから削除（後続の処理に影響しないように）
  args.splice(symbolArgIndex, 2);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log('オプション:');
  console.log('  --xxxxx(戦略名）で atomicExec が指定されている戦略を単一実行');
  console.log('  --symbol, -s [シンボル]  特定の通貨ペア（例：BTC/JPY）のみを処理');
  console.log('  --help, -h        このヘルプメッセージを表示');
  console.log('オプションなしで実行すると、atomicExec 以外の戦略全てを実行');
  process.exit(0);
}

/**
 * ボットを起動する関数
 */
async function startBot() {
  initializeDB();
  try {
    // コマンドライン引数があるかどうかをチェック
    const hasArgs = args.length > 0;
    console.log(`コマンドライン引数: ${hasArgs ? '指定あり' : '指定なし'}`);
    if (targetSymbol) {
      console.log(`指定された通貨ペア: ${targetSymbol}`);
    }
  
    while (true) {
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
      
      // 各取引所-シンボルの組み合わせに対して
      for (const { exchangeId, symbol, marketParameters } of allExchangeSymbolPairs) {
        // 取引所情報を取得
        const exchangeConfig = config.exchanges[exchangeId];
        if (!exchangeConfig) continue;

        const exchangeInstance = exchangeConfig.instance;

        console.log(`========== 取引所: ${exchangeId} - 通貨ペア: ${symbol} ==========`); 

        try {
          // 約定済み取引の更新
          await updateFilledTrades(exchangeInstance, symbol);

          // 包括的未約定注文管理システムの初期化
          if (!globalOrderManagers[exchangeId]) {
            const redis = require('redis');
            const redisClient = redis.createClient({
              url: process.env.REDIS_URL || 'redis://localhost:6379'
            });
            await redisClient.connect();
            
            globalOrderManagers[exchangeId] = new PendingOrderLimitManager(exchangeInstance, redisClient);
            globalOrderValidators[exchangeId] = new OrderValidation(exchangeInstance);
            
            console.log(`[注文管理] 初期化完了: ${exchangeId}`);
          }

          // 強化版未約定注文クリーンアップ（5分間隔）
          const now = Date.now();
          const cleanupInterval = 5 * 60 * 1000; // 5分
          const lastTime = lastCleanupTime[exchangeId] || 0;
          
          if (now - lastTime >= cleanupInterval) {
            try {
              console.log(`[強化クリーンアップ] 開始: ${exchangeId}`);
              const enhancedResult = await enhancedPendingOrderCleanup(exchangeInstance, exchangeId, false);
              lastCleanupTime[exchangeId] = now;
              
              if (enhancedResult.success && enhancedResult.cleanupResult.deleted > 0) {
                console.log(`[強化クリーンアップ] 成功: ${exchangeId} - ${enhancedResult.cleanupResult.deleted}件削除`);
              } else if (!enhancedResult.success) {
                console.warn(`[強化クリーンアップ] 失敗: ${exchangeId} - ${enhancedResult.error}`);
              }
            } catch (cleanupError) {
              console.warn(`[強化クリーンアップ] エラー: ${exchangeId} - ${cleanupError.message}`);
            }
          }

          // 包括的未約定注文管理（10分間隔）
          if (now - lastComprehensiveCleanupTime >= COMPREHENSIVE_CLEANUP_INTERVAL) {
            try {
              console.log(`[包括管理] 開始: ${exchangeId}`);
              const orderManager = globalOrderManagers[exchangeId];
              
              if (orderManager) {
                // ヘルスチェック実行
                const health = await orderManager.healthCheck();
                console.log(`[包括管理] ヘルス: ${health.status} (利用率: ${health.utilization}, 買い比率: ${health.buyRatio})`);
                
                // 制限違反の確認
                const violations = await orderManager.detectLimitViolations();
                
                if (violations.length > 0) {
                  const highPriorityViolations = violations.filter(v => v.severity === 'high');
                  
                  if (highPriorityViolations.length > 0) {
                    console.log(`[包括管理] 緊急対応必要: ${highPriorityViolations.length}件の高優先度違反`);
                    
                    // 自動修復実行
                    const remediationResult = await orderManager.performAutoCleanup();
                    console.log(`[包括管理] 自動修復完了: ${remediationResult.cleaned}件削除`);
                    
                    // Discord通知（詳細版）
                    if (remediationResult.cleaned > 0) {
                      let message = `🔧 **未約定注文自動整理完了** (${exchangeId})\n` +
                                   `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                   `📈 **修復結果**\n` +
                                   `　削除件数: ${remediationResult.cleaned}件\n` +
                                   `　緊急度: 🚨 高優先度 (${highPriorityViolations.length}件違反)\n`;
                      
                      // 修復アクション詳細
                      if (remediationResult.actions && remediationResult.actions.length > 0) {
                        message += `\n🛠️ **修復アクション**\n`;
                        remediationResult.actions.forEach(action => {
                          message += `　• ${action}\n`;
                        });
                      }
                      
                      // 健全性情報
                      message += `\n📊 **修復前の状況**\n` +
                                `　利用率: ${health.utilization}\n` +
                                `　買い注文比率: ${health.buyRatio}\n` +
                                `　制限違反: ${violations.length}件\n`;
                      
                      message += `\n⏰ ${new Date().toLocaleString('ja-JP')}`;
                      
                      await postOrderToDiscord(message);
                    }
                  } else {
                    console.log(`[包括管理] 中優先度違反: ${violations.length}件 - 監視継続`);
                    
                    // 中優先度違反の通知（12時間に1回程度）
                    const lastMediumNotify = globalOrderManagers[exchangeId].lastMediumNotifyTime || 0;
                    const mediumNotifyInterval = 12 * 60 * 60 * 1000; // 12時間
                    
                    if (now - lastMediumNotify >= mediumNotifyInterval) {
                      const mediumViolations = violations.filter(v => v.severity === 'medium');
                      let message = `⚠️ **未約定注文監視レポート** (${exchangeId})\n` +
                                   `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                   `📊 **現在の状況**\n` +
                                   `　利用率: ${health.utilization}\n` +
                                   `　買い注文比率: ${health.buyRatio}\n` +
                                   `　中優先度違反: ${mediumViolations.length}件\n\n` +
                                   `⚡ **主な違反内容**\n`;
                      
                      mediumViolations.slice(0, 5).forEach(violation => {
                        message += `　• ${violation.message}\n`;
                      });
                      
                      if (mediumViolations.length > 5) {
                        message += `　... 他 ${mediumViolations.length - 5} 件\n`;
                      }
                      
                      message += `\n📈 **対応状況**: 監視継続中（自動修復待機）\n`;
                      message += `⏰ ${new Date().toLocaleString('ja-JP')}`;
                      
                      await postOrderToDiscord(message);
                      globalOrderManagers[exchangeId].lastMediumNotifyTime = now;
                    }
                  }
                } else {
                  console.log(`[包括管理] 正常: 制限違反なし`);
                  
                  // 正常状態の通知（24時間に1回）
                  const lastHealthyNotify = globalOrderManagers[exchangeId].lastHealthyNotifyTime || 0;
                  const healthyNotifyInterval = 24 * 60 * 60 * 1000; // 24時間
                  
                  if (now - lastHealthyNotify >= healthyNotifyInterval) {
                    let message = `✅ **未約定注文システム正常** (${exchangeId})\n` +
                                 `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                 `📊 **健全性状況**\n` +
                                 `　利用率: ${health.utilization}\n` +
                                 `　買い注文比率: ${health.buyRatio}\n` +
                                 `　制限違反: なし\n` +
                                 `　状態: ${health.status === 'healthy' ? '✅ 健全' : '⚠️ 要注意'}\n\n` +
                                 `🔧 **最終クリーンアップ**: ${health.lastCleanup}\n` +
                                 `⏰ ${new Date().toLocaleString('ja-JP')}`;
                    
                    await postOrderToDiscord(message);
                    globalOrderManagers[exchangeId].lastHealthyNotifyTime = now;
                  }
                }
                
                lastComprehensiveCleanupTime = now;
              }
            } catch (comprehensiveError) {
              console.warn(`[包括管理] エラー: ${exchangeId} - ${comprehensiveError.message}`);
            }
          }

          // 残高整合性チェック（5分間隔）
          if (now - lastBalanceCheckTime >= BALANCE_CHECK_INTERVAL) {
            try {
              console.log(`[残高チェック] 開始: ${exchangeId}`);
              const { compareBalances } = require('./common/balanceChecker');
              const result = await compareBalances(exchangeId);
              
              if (result.discrepancies.length > 0) {
                console.log(`[残高チェック] 不整合検出: ${result.discrepancies.length}件`);
                
                // 不整合が検出された場合の詳細ログ
                for (const discrepancy of result.discrepancies) {
                  console.log(`  ${discrepancy.currency}: Bot ${discrepancy.botAmount} vs 取引所 ${discrepancy.exchangeAmount} (${discrepancy.discrepancyPercent}%差)`);
                }
                
                // 高い不整合（10%以上）が検出された場合、Discord通知
                const highDiscrepancies = result.discrepancies.filter(d => Math.abs(d.discrepancyPercent) >= 10);
                if (highDiscrepancies.length > 0) {
                  let message = `⚠️ **残高不整合検出** (${exchangeId})\n` +
                               `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                               `📊 **不整合通貨**: ${highDiscrepancies.length}件\n\n`;
                  
                  highDiscrepancies.forEach(d => {
                    message += `💱 **${d.currency}**\n` +
                              `　Bot計算: ${d.botAmount.toFixed(6)}\n` +
                              `　取引所: ${d.exchangeAmount.toFixed(6)}\n` +
                              `　差異: ${d.discrepancyPercent.toFixed(2)}%\n\n`;
                  });
                  
                  message += `⏰ ${new Date().toLocaleString('ja-JP')}`;
                  await postOrderToDiscord(message);
                }
              } else {
                console.log(`[残高チェック] 正常: 不整合なし`);
              }
              
              lastBalanceCheckTime = now;
            } catch (balanceError) {
              console.warn(`[残高チェック] エラー: ${exchangeId} - ${balanceError.message}`);
            }
          }

          // 自己修復システム（30分間隔）
          if (now - lastSelfHealingTime >= SELF_HEALING_INTERVAL) {
            try {
              console.log(`[自己修復] 開始: ${exchangeId}`);
              const { Phase2SelfHealingSystem } = require('../scripts/phase2SelfHealingSystem');
              const healer = new Phase2SelfHealingSystem();
              
              // 自己修復実行 (✅ FIX: Corrected method name from performSelfHealing to executeSelfHealing)
              const healingResult = await healer.executeSelfHealing();
              
              // 安全なプロパティアクセスのためのnullチェック
              if (healingResult && typeof healingResult === 'object') {
                const totalFixed = healingResult.totalFixed || 0;
                const phantomFixed = healingResult.phantomFixed || 0;
                const partialFixed = healingResult.partialFixed || 0;
                const minorFixed = healingResult.minorFixed || 0;
                const details = healingResult.details || [];
                
                if (totalFixed > 0) {
                  console.log(`[自己修復] 修復完了: ${totalFixed}件`);
                  
                  let message = `🔧 **自己修復システム実行** (${exchangeId})\n` +
                               `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                               `✅ **修復結果**\n` +
                               `　偽約定ポジション: ${phantomFixed}件削除\n` +
                               `　部分約定: ${partialFixed}件修正\n` +
                               `　軽微な不整合: ${minorFixed}件調整\n` +
                               `　合計: ${totalFixed}件\n\n`;
                  
                  if (details && details.length > 0) {
                    message += `📝 **修復詳細**\n`;
                    details.slice(0, 5).forEach(detail => {
                      message += `　• ${detail}\n`;
                    });
                    
                    if (details.length > 5) {
                      message += `　... 他 ${details.length - 5} 件\n`;
                    }
                  }
                  
                  message += `\n⏰ ${new Date().toLocaleString('ja-JP')}`;
                  await postOrderToDiscord(message);
                } else {
                  console.log(`[自己修復] 正常: 修復対象なし`);
                }
              } else {
                console.log(`[自己修復] 警告: 修復結果が無効です`);
              }
              
              lastSelfHealingTime = now;
            } catch (healingError) {
              console.warn(`[自己修復] エラー: ${exchangeId} - ${healingError.message}`);
            }
          }

          // Ticker情報を取得
          // 同時にキャッシュする効果もある
          const ticker = await fetchTicker(exchangeInstance, symbol);
          // console.log(`Ticker: ${exchangeId} - ${symbol} - ${JSON.stringify(ticker)}`);
          
          // 有効な戦略を適用
          for (const strategyKey of Object.keys(config.strategies)) {
            const strategy = config.strategies[strategyKey];
            
            // 戦略自体か、個別設定で戦略が無効の場合はスキップ
            const strategyConfig = await getStrategyConfig(exchangeInstance, symbol, strategyKey, config);
            if (!strategy.enabled || !strategyConfig.enabled) {
              console.log(`戦略 ${strategyKey} が無効です`);
              continue;
            }
            
            // コマンドライン引数で指定された戦略以外はスキップ
            if (hasArgs && !args.includes(`--${strategyKey}`)) {
              continue;
            }
            
            // atomicExec指定でコマンドライン引数なしの場合はスキップ
            if (strategy.atomicExec && (!hasArgs || !args.includes(`--${strategyKey}`))) {
              console.log(`戦略 ${strategyKey} は単一コンテナ実行指定戦略です: SKIP`);
              continue;
            }
            
            // 新しいHFT戦略 (WebSocketベース) の場合
            if (strategyKey === 'HFT') {
              // HFTは別コンテナで実行予定
              continue;
              // // HFT戦略は内部で通貨ペアのループとWebSocket接続を管理するため、
              // // ここでは戦略のエントリポイント関数を一度だけ呼び出す
              // console.log(`--- 戦略 ${strategyKey} を実行中...`);
              // try {
              //   await strategy.function(config); // startHFTStrategy(config) を呼び出し
              // } catch (error) {
              //   console.error(`戦略 ${strategyKey} の実行中にエラーが発生しました: ${error.message}`);
              //   await postErrorToDiscord(`戦略 ${strategyKey} でエラー: ${error.message}`).catch(() => {});
              // }
              // // HFT戦略は常駐するため、このループの他の通貨ペアでは実行しない
              // continue;
            }

            // この戦略が対象の取引所をサポートしているか確認 (HFT_BB_WS以外)
            const supportedExchange = strategy.exchanges.find(e => e.id === exchangeId);
            if (!supportedExchange) continue;

            try {
              await runStrategy(strategy, supportedExchange, symbol, strategyKey, marketParameters, { allExchangeSymbolPairs, config });
            } catch (error) {
              await errorHandler.handleError(error, `戦略 ${strategyKey}、通貨ペア ${symbol}`, false);
            }
          }
        } catch (error) {
          await errorHandler.handleError(error, `通貨ペア ${symbol}`, false);
        }
      }
      
      await sleep(1000);
    }
    
  } catch (error) {
    const errorMessage = `エラーが発生しました: ${error.message}`;
    console.error(errorMessage, error);
    await postErrorToDiscord(errorMessage);
  } finally {
    // DB接続をクローズ
    process.exit(0);
  }
}

/**
 * リスク管理チェックを実行する関数
 * ストップロス、トレーリングストップ、タイムストップの処理を行う
 */
async function executeRiskManagementCheck() {
  try {
    // 積極的なクリーンアップを実行（リスク管理前）
    console.log('[リスク管理] 事前クリーンアップ開始...');
    let preCleanupCount = 0;
    
    // 取引所別に事前クリーンアップを実行（強化版）
    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (!exchangeConfig) continue;
      try {
        const enhancedResult = await enhancedPendingOrderCleanup(exchangeConfig.instance, exchangeId, true);
        if (enhancedResult.success && enhancedResult.cleanupResult) {
          preCleanupCount += enhancedResult.cleanupResult.deleted;
        }
      } catch (cleanupError) {
        console.warn(`[リスク管理] 事前強化クリーンアップエラー ${exchangeId}: ${cleanupError.message}`);
      }
    }
    
    if (preCleanupCount > 0) {
      console.log(`[リスク管理] 事前クリーンアップ完了: ${preCleanupCount}件削除`);
    }
    
    // 全ポジションを取得
    const allPositions = await getAllPositionsRedis();
    
    if (allPositions.length === 0) {
      console.log('[リスク管理] チェック対象のポジションがありません');
      return;
    }
    
    console.log(`[リスク管理] ${allPositions.length}個のポジションをチェック中...`);
    
    // 不整合ポジションの事前検出と修復
    let preRepairCount = 0;
    const validPositions = [];
    
    for (const position of allPositions) {
      try {
        // 基本的な整合性チェック
        if (!position.amount || position.amount <= 0 || 
            !position.entryPrice || position.entryPrice <= 0 ||
            !position.symbol || !position.exchangeId) {
          console.warn(`[リスク管理] 無効なポジションデータ: ${position.key || 'unknown'}`);
          
          // 無効なポジションを削除
          try {
            const { closeAndCleanupPosition } = require('./database/redisDatabase');
            await closeAndCleanupPosition(position.key);
            preRepairCount++;
          } catch (cleanupError) {
            console.warn(`[リスク管理] 無効ポジション削除失敗: ${cleanupError.message}`);
          }
          continue;
        }
        
        validPositions.push(position);
      } catch (checkError) {
        console.warn(`[リスク管理] ポジションチェックエラー: ${checkError.message}`);
        validPositions.push(position); // エラー時は保守的に保持
      }
    }
    
    if (preRepairCount > 0) {
      console.log(`[リスク管理] 事前修復完了: ${preRepairCount}個の無効ポジション削除`);
    }
    
    console.log(`[リスク管理] 有効ポジション: ${validPositions.length}個を処理開始`);
    
    // 取引所ごとにグループ化
    const positionsByExchange = {};
    for (const position of validPositions) {
      if (!positionsByExchange[position.exchangeId]) {
        positionsByExchange[position.exchangeId] = [];
      }
      positionsByExchange[position.exchangeId].push(position);
    }
    
    let totalProcessed = 0;
    let totalStopLossExecuted = 0;
    
    // 各取引所のポジションを処理
    for (const [exchangeId, positions] of Object.entries(positionsByExchange)) {
      try {
        // 取引所インスタンスを取得
        const exchangeConfig = config.exchanges[exchangeId];
        if (!exchangeConfig) {
          console.warn(`[リスク管理] 取引所設定が見つかりません: ${exchangeId}`);
          continue;
        }
        
        const exchangeInstance = exchangeConfig.instance;
        
        // シンボルごとにグループ化
        const positionsBySymbol = {};
        for (const position of positions) {
          if (!positionsBySymbol[position.symbol]) {
            positionsBySymbol[position.symbol] = [];
          }
          positionsBySymbol[position.symbol].push(position);
        }
        
        // 各シンボルのポジションを処理
        for (const [symbol, symbolPositions] of Object.entries(positionsBySymbol)) {
          try {
            // リスク管理設定を取得
            const riskSettings = {
              fixedStopLossPercent: 0.03, // 3%のストップロス（より積極的）
              trailingStopTriggerPercent: 0.02, // 2%の利益でトレーリング発動
              trailingStopDistancePercent: 0.02, // 最高値から2%下でトレーリング
              timeBasedStopHours: 24, // 24時間でタイムストップ（より短縮）
            };
            
            // 各ポジションのストップロスをチェック
            const allStopLossPositions = [];
            
            for (const position of symbolPositions) {
              // 現在価格を取得
              const ticker = await fetchTicker(exchangeInstance, symbol);
              const currentPrice = ticker.last;
              
              // 時間ベースのストップロスチェック
              const positionAge = (Date.now() - position.createdAt) / (1000 * 60 * 60); // 時間単位
              const timeBasedStop = positionAge >= riskSettings.timeBasedStopHours;
              
              // 価格ベースのストップロスチェック（3%損失）
              const priceBasedStop = currentPrice <= position.entryPrice * (1 - riskSettings.fixedStopLossPercent);
              
              if (timeBasedStop || priceBasedStop) {
                console.log(`[リスク管理] ストップロス対象: ${position.strategyKey} ${symbol} - 経過時間: ${positionAge.toFixed(1)}h, 理由: ${timeBasedStop ? 'time-based' : 'price-based'}`);
                allStopLossPositions.push({
                  ...position,
                  reason: timeBasedStop ? 'time-based' : 'price-based',
                  currentPrice,
                  positionAge: positionAge.toFixed(1)
                });
              }
            }
            
            if (allStopLossPositions.length > 0) {
              console.log(`[リスク管理] ${symbol}: ${allStopLossPositions.length}個のポジションでストップロス発動`);
              
              // ストップロス実行
              for (const position of allStopLossPositions) {
                try {
                  // 実行前の不整合チェック
                  const baseAsset = symbol.split('/')[0];
                  
                  // 実際の残高を確認
                  let actualBalance = 0;
                  try {
                    const balance = await exchangeInstance.fetchBalance();
                    actualBalance = balance.total[baseAsset] || 0;
                  } catch (balanceError) {
                    console.warn(`[リスク管理] 残高取得失敗 ${symbol}: ${balanceError.message}`);
                  }
                  
                  // より包括的な不整合チェック
                  const { getTradeCurrentPosition, formattedAvailableAmount } = require('./database/manager');
                  const netPosition = await getTradeCurrentPosition(exchangeInstance, symbol, position.strategyKey);
                  
                  // availableToSellを安全に初期化
                  let availableToSell = 0;
                  try {
                    // マーケットパラメータを取得してからavailableToSellを計算
                    const marketParams = await getMarketParametersByExchangeSymbol(
                      { [exchangeInstance.id]: [symbol] }, 
                      config,
                      {}
                    );
                    const marketParameters = marketParams[exchangeInstance.id][symbol];
                    const amountPrecision = marketParameters.amountPrecision || 8;
                    
                    availableToSell = await formattedAvailableAmount(exchangeInstance, symbol, position.strategyKey, amountPrecision);
                  } catch (availableError) {
                    console.warn(`[DEBUG] availableToSell取得失敗 ${symbol}: ${availableError.message}`);
                    availableToSell = 0;
                  }
                  
                  // 複数の不整合パターンをチェック
                  const hasZeroBalance = actualBalance === 0;
                  const hasPositiveNet = netPosition > 0;
                  const hasPositivePosition = position.amount > 0;
                  
                  // パターン1: 実際残高0だが記録ポジションあり
                  const pattern1 = hasZeroBalance && hasPositivePosition;
                  
                  // パターン2: 実際残高0だがネットポジションあり  
                  const pattern2 = hasZeroBalance && hasPositiveNet;
                  
                  // パターン3: ネットポジション > 実際残高の大幅乖離
                  const pattern3 = hasPositiveNet && actualBalance > 0 && (netPosition > actualBalance * 2);
                  
                  // パターン4: 負のネットポジション（売り>買いの異常状態）
                  const pattern4 = netPosition < 0;
                  
                  // パターン5: 未約定注文による利用可能量ブロック
                  const pattern5 = availableToSell <= 0 && actualBalance > position.amount && netPosition > 0;
                  
                  if (pattern1 || pattern2 || pattern3 || pattern4 || pattern5) {
                    const patternType = pattern1 ? 'position-mismatch' : 
                                       pattern2 ? 'net-mismatch' : 
                                       pattern3 ? 'balance-mismatch' :
                                       pattern4 ? 'negative-net' :
                                       'pending-order-block';
                    console.warn(`[リスク管理] 不整合ポジション検出(${patternType}): ${position.strategyKey} ${symbol} - 実際残高${actualBalance}、記録ポジション${position.amount}、ネット${netPosition}`);
                    
                    try {
                      // パターン別修復処理
                      if (pattern5) {
                        // 未約定注文ブロック修復
                        console.log(`[リスク管理] 未約定注文ブロック修復開始: ${symbol} ${position.strategyKey}`);
                        
                        // 該当戦略の未約定注文をクリーンアップ
                        try {
                          const { cleanupStrategyPendingOrders } = require('./database/redisDatabase');
                          const cleanupResult = await cleanupStrategyPendingOrders(exchangeInstance.id, symbol, position.strategyKey);
                          
                          console.log(`[リスク管理] 未約定注文クリーンアップ完了: ${cleanupResult.deleted}件削除`);
                          
                          // クリーンアップ後に再度利用可能量を計算
                          const newAvailableAmount = await formattedAvailableAmount(exchangeInstance, symbol, position.strategyKey, amountPrecision);
                          
                          if (newAvailableAmount > 0) {
                            availableToSell = Math.min(position.amount, newAvailableAmount);
                            console.log(`[リスク管理] クリーンアップ後の利用可能量: ${newAvailableAmount} → 売却量: ${availableToSell}`);
                          } else {
                            // それでもダメな場合は実際の残高を使用
                            availableToSell = Math.min(position.amount, actualBalance);
                            console.log(`[リスク管理] フォールバック: 実際残高${actualBalance}を使用 → 売却量: ${availableToSell}`);
                          }
                          
                          await postErrorToDiscord(`🧹 [未約定注文修復] ${exchangeInstance.id} - ${symbol} - ${position.strategyKey}\n削除: ${cleanupResult.deleted}件\n利用可能量: 0 → ${availableToSell}\n実残高: ${actualBalance}`);
                          
                        } catch (cleanupError) {
                          console.error(`[リスク管理] 未約定注文クリーンアップ失敗: ${cleanupError.message}`);
                          // クリーンアップ失敗時は実際の残高を強制使用
                          availableToSell = Math.min(position.amount, actualBalance);
                          console.log(`[リスク管理] クリーンアップ失敗、実際残高を強制使用: ${availableToSell}`);
                        }
                        
                      } else if (pattern2 || pattern4) {
                        // ⚠️ 危険: ネットポジションリセットは戦略間データ損失を引き起こす
                        // 一時的に無効化 - 代替案として単純なポジション削除のみ実行
                        console.warn(`[リスク管理] 危険な包括修復を無効化: ${symbol} ${position.strategyKey} (ネット=${netPosition}, 実残高=${actualBalance})`);
                        
                        // 単純な個別ポジション削除のみ実行（サマリーリセットなし）
                        const { closeAndCleanupPosition } = require('./database/redisDatabase');
                        await closeAndCleanupPosition(position.key);
                        console.log(`[リスク管理] 単純削除完了: ${position.key}`);
                        
                        await postOrderToDiscord(`⚠️ [安全削除] ${exchangeInstance.id} - ${symbol} - ${position.strategyKey}\n個別ポジション削除のみ実行\nネット: ${netPosition} (保持)\n実残高: ${actualBalance} (保持)`);
                        
                        /* 危険なサマリーリセットコードを無効化 - 戦略間データ損失を防ぐため
                        console.log(`[リスク管理] ネットポジション包括修復開始${isNegative ? '(負の値)' : ''}: ${symbol} ${position.strategyKey}`);
                        
                        // 1. 該当戦略の全ポジションを取得
                        const { getStrategyPositionsRedis, getTradeSummary, updateTradeSummary } = require('./database/redisDatabase');
                        const allStrategyPositions = await getStrategyPositionsRedis(exchangeInstance.id, symbol, position.strategyKey);
                        
                        // 2. 全ポジションを削除
                        let deletedCount = 0;
                        for (const pos of allStrategyPositions) {
                          try {
                            const { closeAndCleanupPosition } = require('./database/redisDatabase');
                            await closeAndCleanupPosition(pos.key);
                            deletedCount++;
                          } catch (deleteError) {
                            console.warn(`[リスク管理] ポジション削除失敗: ${pos.key}`);
                          }
                        }
                        
                        // 3. 負のネットポジションの場合は取引履歴から再計算
                        if (isNegative) {
                          console.log(`[リスク管理] 負のネットポジション検出: ${netPosition} - 取引履歴から再計算開始`);
                          
                          try {
                            // MongoDBから取引履歴を取得して再計算
                            const { recalculateTradeSummaryFromMongoDB } = require('./database/manager');
                            const newSummary = await recalculateTradeSummaryFromMongoDB(exchangeInstance.id, symbol, position.strategyKey);
                            
                            console.log(`[リスク管理] 再計算完了: 新ネットポジション=${newSummary.netPosition}, 買い量=${newSummary.buyAmount}, 売り量=${newSummary.sellAmount}`);
                            
                            // 再計算後もまだ負の場合は強制リセット
                            if (newSummary.netPosition < 0) {
                              console.warn(`[リスク管理] 再計算後も負のネットポジション: ${newSummary.netPosition} - 強制リセット実行`);
                              throw new Error('再計算後も負のネットポジション');
                            }
                          } catch (recalcError) {
                            console.error(`[リスク管理] 再計算失敗: ${recalcError.message} - 強制リセットに切り替え`);
                            // 再計算失敗時は強制リセット
                            const summaryKey = `summary:trade:${exchangeInstance.id}:${symbol}:${position.strategyKey}`;
                            const { getClient } = require('./database/redisDatabase');
                            const client = getClient();
                            
                            await client.hSet(summaryKey, {
                              netPosition: 0,
                              buyAmount: 0,
                              sellAmount: 0,
                              totalBuyCost: 0,
                              totalSellRevenue: 0,
                              updatedAt: Date.now()
                            });
                            
                            console.log(`[リスク管理] 取引サマリー強制リセット完了: ${summaryKey}`);
                          }
                        } else {
                          // 通常の強制リセット
                          try {
                            const summaryKey = `summary:trade:${exchangeInstance.id}:${symbol}:${position.strategyKey}`;
                            const { getClient } = require('./database/redisDatabase');
                            const client = getClient();
                            
                            await client.hSet(summaryKey, {
                              netPosition: 0,
                              buyAmount: 0,
                              sellAmount: 0,
                              totalBuyCost: 0,
                              totalSellRevenue: 0,
                              updatedAt: Date.now()
                            });
                            
                            console.log(`[リスク管理] 取引サマリー強制リセット完了: ${summaryKey}`);
                          } catch (resetError) {
                            console.warn(`[リスク管理] サマリーリセット失敗: ${resetError.message}`);
                          }
                        }
                        
                        console.log(`[リスク管理] ネットポジション包括修復完了: ${deletedCount}ポジション削除、サマリーリセット`);
                        
                        // Discord通知
                        await postErrorToDiscord(`🔧 [包括修復] ${exchangeInstance.id} - ${symbol} - ${position.strategyKey}\n削除: ${deletedCount}ポジション\nネット: ${netPosition} → 0\n実残高: ${actualBalance}`);
                        */ // 危険なサマリーリセットコード終了
                        
                      } else {
                        // 単一ポジション削除（従来の処理）
                        const { closeAndCleanupPosition } = require('./database/redisDatabase');
                        await closeAndCleanupPosition(position.key);
                        console.log(`[リスク管理] 不整合ポジション自動削除完了: ${position.key}`);
                        
                        // Discord通知
                        await postOrderToDiscord(`🧹 [自動修復] 不整合ポジション削除: ${exchangeInstance.id} - ${symbol} - ${position.strategyKey} (残高${actualBalance}、記録${position.amount})`);
                      }
                      
                      totalStopLossExecuted++; // 削除も成功としてカウント
                      continue; // 次のポジションへ
                    } catch (cleanupError) {
                      console.error(`[リスク管理] 不整合ポジション削除失敗: ${cleanupError.message}`);
                    }
                  }
                  
                  // マーケットパラメータを取得
                  const marketParams = await getMarketParametersByExchangeSymbol(
                    { [exchangeId]: [symbol] }, 
                    config,
                    {}
                  );
                  const marketParameters = marketParams[exchangeId][symbol];
                  
                  console.log(`[リスク管理] ストップロス実行: ${position.strategyKey} ${symbol} (理由: ${position.reason})`);
                  
                  const result = await executeStopLoss(
                    exchangeInstance, 
                    symbol, 
                    position.strategyKey, 
                    position, 
                    marketParameters
                  );
                  
                  if (result.success) {
                    totalStopLossExecuted++;
                    if (result.reason === 'auto_cleanup') {
                      console.log(`[リスク管理] 自動修復完了: ${symbol} - ${result.message}`);
                    } else {
                      console.log(`[リスク管理] ストップロス成功: ${symbol} - ${result.soldAmount} ${symbol.split('/')[0]}`);
                    }
                  } else {
                    console.warn(`[リスク管理] ストップロス失敗: ${symbol} - ${result.message || result.error}`);
                  }
                } catch (stopLossError) {
                  console.error(`[リスク管理] ストップロス実行エラー: ${symbol} - ${stopLossError.message}`);
                  console.error(`[DEBUG] ストップロスエラー詳細:`, stopLossError.stack);
                  console.error(`[DEBUG] エラー発生時のパラメータ:`, {
                    symbol,
                    strategyKey: position.strategyKey,
                    positionAmount: position.amount,
                    marketParametersExists: !!marketParameters
                  });
                }
              }
            }
            
            totalProcessed += symbolPositions.length;
          } catch (symbolError) {
            console.error(`[リスク管理] シンボル処理エラー: ${symbol} - ${symbolError.message}`);
          }
        }
      } catch (exchangeError) {
        console.error(`[リスク管理] 取引所処理エラー: ${exchangeId} - ${exchangeError.message}`);
      }
    }
    
    console.log(`[リスク管理] 処理完了: ${totalProcessed}個処理、${totalStopLossExecuted}個のストップロス実行`);
    
    if (totalStopLossExecuted > 0) {
      await postOrderToDiscord(`[リスク管理] ${totalStopLossExecuted}個のポジションでストップロスを実行しました`);
    }
    
  } catch (error) {
    console.error('[リスク管理] チェック処理エラー:', error.message);
    throw error;
  }
}

/**
 * 指定された戦略を実行する関数
 * @param {Object} exchange - 取引所オブジェクト
 * @param {String} symbol - 通貨ペア
 * @param {String} strategyKey - 戦略のキー
 * @param {Object} marketParametersBySymbol - 通貨ペアごとの市場パラメータ
 * @param {Object} options - オプションオブジェクト
 */
async function runStrategy(strategy, exchange, symbol, strategyKey, marketParametersBySymbol, options) {
  try {

    // TODO: ループの最初で取得してメモリから復元するようにする (performance向上)
    const strategyConfig = await getStrategyConfig(exchange, symbol, strategyKey, config);

    if (strategyConfig.enabled === false) {
      console.log(`戦略 ${strategyKey}:${symbol} は個別に無効化されています`);
      return null;
    }

    // MUTUAL_INFO戦略の場合は、referenceSymbolsを設定
    if (strategyKey === 'MUTUAL_INFO' && options.allExchangeSymbolPairs) {
      // 同じ取引所のシンボルのみを抽出し、自分自身と除外シンボルを除外
      const sameExchangeSymbols = options.allExchangeSymbolPairs
        .filter(pair => 
          pair.exchangeId === exchange.id && 
          pair.symbol !== symbol &&
          !config.global.excludeSymbols.some(excludePattern => pair.symbol.startsWith(excludePattern))
        )
        .map(pair => pair.symbol);
      
      options.referenceSymbols = sameExchangeSymbols;
    }

    console.log(`--- 戦略 ${strategyKey} を実行中...`);
    return strategy.function(exchange, symbol, strategyKey, strategyConfig, marketParametersBySymbol, options)
  } catch (error) {
    console.error(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${symbol}`, error);
    if (postErrorToDiscord) {
      await postErrorToDiscord(`戦略の実行中にエラーが発生しました: ${strategyKey} - ${exchange.id} - ${symbol} - ${error.message}`);
    }
    return null;
  }
}

// レポートを投稿するためのタイマー設定
// setInterval(() => {
//   const now = new Date();
//   if (now.getMinutes() === 0) { // 時間ごと
//     // 全体資産計算レポート
//     postReport(exchangeBB);
//     postReport(exchangeBF);
    
//     // 戦略と銘柄ごとの損益レポート
//     postStrategyProfitReport(exchangeBB);
//     postStrategyProfitReport(exchangeBF);
//   }
// }, 60000); // 1分ごとにチェック

/**
 * 堅牢な残高チェックの実行関数
 */
async function executeRobustBalanceCheck() {
  try {
    console.log('=== 定期残高整合性チェック開始 ===');
    const { compareBalancesRobust } = require('./common/balanceChecker');
    
    const results = [];
    for (const exchangeId of Object.keys(config.exchanges)) {
      try {
        const result = await compareBalancesRobust(exchangeId);
        results.push(result);
        
        if (!result.skipped) {
          console.log(`[残高チェック] ${exchangeId}: ${result.hasDiscrepancies ? 'エラー' : 'OK'}`);
        }
        
        // 各取引所チェック間の待機（設定から取得）
        await new Promise(resolve => setTimeout(resolve, BALANCE_CONFIG.intervals.exchangeCheckDelay));
      } catch (error) {
        console.error(`[残高チェック] ${exchangeId}エラー:`, error.message);
        results.push({ exchangeId, success: false, error: error.message });
      }
    }
    
    const errorCount = results.filter(r => !r.success || r.hasDiscrepancies).length;
    console.log(`=== 定期残高整合性チェック完了 (${errorCount}件のエラー) ===`);
    
  } catch (error) {
    console.error('定期残高整合性チェックエラー:', error.message);
    await postErrorToDiscord(`定期残高整合性チェック失敗: ${error.message}`);
  }
}

/**
 * 効率的な1時間ごとのスケジューリング
 */
function scheduleHourlyRobustBalanceCheck() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0); // 次の時間の0分0秒に設定
  
  const timeUntilNextHour = nextHour.getTime() - now.getTime();
  
  console.log(`[スケジューラー] 次回堅牢残高チェック: ${nextHour.toLocaleString('ja-JP')} (${Math.round(timeUntilNextHour / 1000 / 60)}分後)`);
  
  // 最初の実行を次の正時にスケジュール
  setTimeout(() => {
    executeRobustBalanceCheck().catch(error => {
      console.error('堅牢残高チェック実行エラー:', error.message);
    });
    
    // その後は1時間ごとに実行
    setInterval(() => {
      executeRobustBalanceCheck().catch(error => {
        console.error('堅牢残高チェック実行エラー:', error.message);
      });
    }, BALANCE_CONFIG.intervals.robustCheck);
  }, timeUntilNextHour);
}

// 残高整合性チェックを1時間ごとに実行（堅牢版）- 効率的なスケジューリング
scheduleHourlyRobustBalanceCheck();

// リスク管理処理を定期実行（設定から間隔を取得）
setInterval(async () => {
  try {
    console.log('=== 定期リスク管理チェック開始 ===');
    await executeRiskManagementCheck();
    console.log('=== 定期リスク管理チェック完了 ===');
  } catch (error) {
    console.error('定期リスク管理チェックエラー:', error.message);
    try {
      await postErrorToDiscord(`定期リスク管理チェック失敗: ${error.message}`);
    } catch (discordError) {
      console.error('Discord通知送信エラー:', discordError.message);
    }
  }
}, BALANCE_CONFIG.intervals.lightweightCheck); // 設定から間隔を取得（5分間隔）

// // 初期レポートを投稿
// postReport(exchangeBB);
// postReport(exchangeBF);

// 利用可能な戦略を表示
// console.log('利用可能な戦略:');
// console.log(strategies.getAvailableStrategies());

// ボットを起動
startBot();

// 初回リスク管理チェックを実行（起動から30秒後）
setTimeout(async () => {
  try {
    console.log('=== 初回リスク管理チェック開始 ===');
    await executeRiskManagementCheck();
    console.log('=== 初回リスク管理チェック完了 ===');
  } catch (error) {
    console.error('初回リスク管理チェックエラー:', error.message);
    await postErrorToDiscord(`初回リスク管理チェック失敗: ${error.message}`);
  }
}, 30000); // 30秒後に実行

// アービトラージ戦略を実行
    // if (config.strategies.INTER_EXCHANGE_ARBITRAGE.enabled) {
    //   // 共通の通貨ペアを見つける
    //   const bbMarkets = await exchangeBB.loadMarkets();
    //   const bfMarkets = await exchangeBF.loadMarkets();
      
    //   const bbSymbols = Object.keys(bbMarkets).filter(symbol => symbol.endsWith('/JPY'));
    //   const bfSymbols = Object.keys(bfMarkets).filter(symbol => symbol.endsWith('/JPY'));
      
    //   // 両方の取引所に存在する通貨ペアを見つける
    //   const commonSymbols = bbSymbols.filter(symbol => bfSymbols.includes(symbol));
      
    //   // 定期的にアービトラージ機会を確認
    //   setInterval(async () => {
    //     // 一度に処理する通貨ペアの数を制限（最大3つ）
    //     const symbolsToProcess = commonSymbols.slice(0, 3);
        
    //     // 各通貨ペアの処理の間に待機時間を入れる
    //     for (const symbol of symbolsToProcess) {
    //       try {
    //         await runArbitrageStrategy(exchanges, symbol, {
    //           postOrderToDiscord,
    //           postErrorToDiscord,
    //           tradePercentage: config.tradePercentage
    //         });
    //         // 各通貨ペアの処理の間に3秒待機
    //         await sleep(3000);
    //       } catch (error) {
    //         console.error(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol}`, error);
    //         await postErrorToDiscord(`アービトラージ戦略の実行中にエラーが発生しました: ${symbol} - ${error.message}`);
    //       }
    //     }
        
    //     // 通貨ペアのローテーション（次回は別の通貨ペアを処理）
    //     commonSymbols.push(commonSymbols.shift());
    //   }, 30000); // 30秒ごとに確認（10秒から30秒に延長）
    // }