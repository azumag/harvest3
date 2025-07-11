const { config } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');
const { getStrategyPositionsRedis } = require('../src/database/redisDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');
const { balanceIntegrityService } = require('../src/services/balanceIntegrityService');
const { balanceMonitor } = require('../src/monitors/balanceMonitor');
const { 
  toDecimal, 
  compareBalance, 
  sumBalances, 
  toNumber,
  addBalance 
} = require('../src/common/decimalUtils');

/**
 * 通貨別に全戦略を合算して残高整合性をチェック
 */
class BalanceConsistencyChecker {
  constructor() {
    this.discrepancies = [];
    this.totalChecked = 0;
    this.warnings = [];
  }

  /**
   * 全戦略の残高整合性をチェック
   */
  async checkAllStrategies() {
    console.log('🔍 通貨別合算残高整合性チェックを開始します...\n');

    const exchanges = Object.keys(config.exchanges);

    for (const exchangeId of exchanges) {
      const exchange = config.exchanges[exchangeId]?.instance;
      if (!exchange) {
        continue;
      }

      await this.checkExchangeBalancesBySymbol(exchange, exchangeId);
    }

    await this.generateReport();
  }

  /**
   * 取引所の通貨別残高をチェック（全戦略合算）
   */
  async checkExchangeBalancesBySymbol(exchange, exchangeId) {
    try {
      console.log(`📊 ${exchangeId} の通貨別残高をチェック中...`);

      // 実際の残高を取得
      const actualBalance = await exchange.fetchBalance();

      // 全戦略を取得
      const enabledStrategies = Object.keys(config.strategies).filter(key =>
        config.strategies[key].enabled
      );

      // 通貨別にポジションを合算
      const currencyPositions = await this.aggregatePositionsByCurrency(
        exchangeId,
        enabledStrategies
      );

      // 通貨ごとに残高比較
      await this.compareBalancesByCurrency(
        exchangeId,
        actualBalance,
        currencyPositions
      );

    } catch (error) {
      const warning = `⚠️ ${exchangeId} の残高チェックでエラー: ${error.message}`;
      this.warnings.push(warning);
      console.error(warning);
    }
  }

  /**
   * 通貨別にポジションを合算
   */
  async aggregatePositionsByCurrency(exchangeId, strategies) {
    const currencyPositions = {};

    // 主要通貨ペアを取得
    const markets = ['BTC/JPY', 'ETH/JPY', 'XRP/JPY', 'LTC/JPY', 'BCH/JPY',
      'SOL/JPY', 'DOT/JPY', 'XLM/JPY', 'LINK/JPY', 'GALA/JPY',
      'APE/JPY', 'MANA/JPY', 'SAND/JPY', 'CHZ/JPY', 'OAS/JPY'];

    for (const symbol of markets) {
      const baseAsset = symbol.split('/')[0];

      // この通貨の全戦略ポジションを合算
      let totalAmount = 0;
      const strategyBreakdown = {};

      for (const strategyKey of strategies) {
        try {
          const positions = await getStrategyPositionsRedis(exchangeId, symbol, strategyKey);
          const openPositions = positions.filter(pos => pos.status === 'open' && pos.side === 'buy');

          const strategyAmount = openPositions.reduce((sum, pos) => addBalance(sum, pos.amount, baseAsset), toDecimal(0));

          if (toNumber(strategyAmount) > 0) {
            totalAmount = addBalance(totalAmount, strategyAmount, baseAsset);
            strategyBreakdown[strategyKey] = {
              amount: strategyAmount,
              positions: openPositions.map(pos => ({
                orderId: pos.orderId,
                amount: pos.amount,
                entryPrice: pos.entryPrice,
                createdAt: new Date(pos.createdAt).toLocaleString('ja-JP')
              }))
            };
          }
        } catch (error) {
          console.warn(`ポジション取得エラー: ${symbol} ${strategyKey} - ${error.message}`);
        }
      }

      if (totalAmount > 0) {
        currencyPositions[baseAsset] = {
          symbol,
          totalAmount,
          strategies: strategyBreakdown
        };
      }
    }

    return currencyPositions;
  }

  /**
   * 通貨ごとの残高比較
   */
  async compareBalancesByCurrency(exchangeId, actualBalance, currencyPositions) {
    // チェック対象通貨を取得
    const currencies = new Set([
      ...Object.keys(actualBalance.used || {}),
      ...Object.keys(currencyPositions)
    ]);

    for (const currency of currencies) {
      const actualUsed = actualBalance.used[currency] || 0;
      const actualFree = actualBalance.free[currency] || 0;
      const actualTotal = actualBalance.total[currency] || 0;

      const positionData = currencyPositions[currency];
      const positionTotal = positionData?.totalAmount || 0;

      // 最小量閾値（0.0001未満は無視）
      const threshold = 0.0001;

      if (positionTotal > threshold || actualUsed > threshold) {
        this.totalChecked++;

        const discrepancy = Math.abs(positionTotal - actualUsed);
        const discrepancyPercent = actualUsed > 0 ? (discrepancy / actualUsed) * 100 : 0;

        // 1%以上の乖離または0.001以上の絶対差がある場合は記録
        if (discrepancy > 0.001 && (discrepancyPercent > 1 || discrepancy > 0.01)) {
          const issue = {
            exchangeId,
            currency,
            symbol: positionData?.symbol || `${currency}/JPY`,
            actualFree,
            actualUsed,
            actualTotal,
            positionTotal,
            discrepancy,
            discrepancyPercent: discrepancyPercent.toFixed(2),
            strategiesBreakdown: positionData?.strategies || {}
          };

          this.discrepancies.push(issue);

          console.log(`❌ 不整合検出: ${exchangeId} ${currency}`);
          console.log(`   実残高(used): ${actualUsed.toFixed(6)} / 総残高: ${actualTotal.toFixed(6)}`);
          console.log(`   全戦略ポジション合計: ${positionTotal.toFixed(6)}`);
          console.log(`   乖離: ${discrepancy.toFixed(6)} (${discrepancyPercent.toFixed(2)}%)`);

          if (positionData?.strategies) {
            console.log('   戦略別内訳:');
            for (const [strategy, data] of Object.entries(positionData.strategies)) {
              console.log(`     ${strategy}: ${data.amount.toFixed(6)}`);
            }
          }
          console.log();
        } else {
          console.log(`✅ ${currency}: 整合性OK (実used: ${actualUsed.toFixed(6)}, 全ポジション: ${positionTotal.toFixed(6)})`);
        }
      }
    }
  }

  /**
   * 詳細レポートを生成
   */
  async generateReport() {
    console.log('\n' + '='.repeat(80));
    console.log('📋 通貨別残高整合性チェック結果レポート');
    console.log('='.repeat(80));

    console.log(`📊 チェック件数: ${this.totalChecked}件`);
    console.log(`❌ 不整合件数: ${this.discrepancies.length}件`);
    console.log(`⚠️ 警告件数: ${this.warnings.length}件\n`);

    if (this.discrepancies.length > 0) {
      console.log('🚨 検出された不整合:');
      console.log('-'.repeat(60));

      for (const issue of this.discrepancies) {
        console.log(`\n[${issue.exchangeId}] ${issue.currency}`);
        console.log(`  実残高(used): ${issue.actualUsed}`);
        console.log(`  全戦略ポジション合計: ${issue.positionTotal}`);
        console.log(`  乖離: ${issue.discrepancy} (${issue.discrepancyPercent}%)`);

        if (Object.keys(issue.strategiesBreakdown).length > 0) {
          console.log('  戦略別詳細:');
          for (const [strategy, data] of Object.entries(issue.strategiesBreakdown)) {
            console.log(`    ${strategy}: ${data.amount} (${data.positions.length}ポジション)`);
          }
        }
      }
    } else {
      console.log('✅ 不整合は検出されませんでした。全通貨で残高が一致しています。');
    }

    if (this.warnings.length > 0) {
      console.log('\n⚠️ 警告:');
      console.log('-'.repeat(40));
      for (const warning of this.warnings) {
        console.log(`  ${warning}`);
      }
    }

    // Discord通知
    await this.sendDiscordNotification();

    console.log('\n' + '='.repeat(80));
    console.log('残高整合性チェック完了');
    console.log('='.repeat(80));
  }

  /**
   * Discord通知を送信
   */
  async sendDiscordNotification() {
    const severity = this.discrepancies.length > 0 ? '🚨' : '✅';
    const status = this.discrepancies.length > 0 ? '不整合検出' : '正常';

    let message = `${severity} [残高チェック] ${status}\n\n`;
    message += `📊 チェック件数: ${this.totalChecked}件\n`;
    message += `❌ 不整合件数: ${this.discrepancies.length}件\n`;
    message += `⚠️ 警告件数: ${this.warnings.length}件\n`;
    message += `🕐 実行時刻: ${new Date().toLocaleString('ja-JP')}\n`;

    if (this.discrepancies.length > 0) {
      message += '\n🚨 主要な不整合：\n';

      const topIssues = this.discrepancies
        .sort((a, b) => parseFloat(b.discrepancyPercent) - parseFloat(a.discrepancyPercent))
        .slice(0, 5);

      for (const issue of topIssues) {
        message += `• ${issue.exchangeId} ${issue.currency}: ${issue.discrepancyPercent}%乖離\n`;
        message += `  実used: ${issue.actualUsed}, 全ポジション: ${issue.positionTotal}\n`;
      }

      if (this.discrepancies.length > 5) {
        message += `...他${this.discrepancies.length - 5}件\n`;
      }
    }

    try {
      if (this.discrepancies.length > 0) {
        await postErrorToDiscord(message);
      } else {
        await postOrderToDiscord(message);
      }
    } catch (error) {
      console.error('Discord通知の送信に失敗:', error.message);
    }
  }
}

/**
 * 拡張されたメイン実行関数 (issue #215)
 */
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'basic';

  console.log(`🔍 残高整合性チェック開始 (モード: ${mode})`);

  try {
    console.log('Redis接続を初期化中...');
    await initRedisClient();
    console.log('Redis接続完了\n');

    switch (mode) {
      case 'basic':
        await runBasicCheck();
        break;
      case 'advanced':
        await runAdvancedCheck();
        break;
      case 'monitor':
        await runMonitoringMode();
        break;
      case 'service':
        await runServiceMode();
        break;
      case 'metrics':
        await showMetrics();
        break;
      default:
        console.log('利用可能なモード:');
        console.log('  basic    - 基本的な整合性チェック (デフォルト)');
        console.log('  advanced - 高度な整合性チェック (3つのデータソース比較)');
        console.log('  monitor  - 監視モードで実行');
        console.log('  service  - サービスモードで実行');
        console.log('  metrics  - メトリクス表示');
        process.exit(1);
    }

  } catch (error) {
    console.error('チェック実行エラー:', error);
    process.exit(1);
  } finally {
    console.log('🔍 残高整合性チェック完了');
    process.exit(0);
  }
}

/**
 * 基本チェック（既存機能）
 */
async function runBasicCheck() {
  const checker = new BalanceConsistencyChecker();
  await checker.checkAllStrategies();
}

/**
 * 高度なチェック（新機能）
 */
async function runAdvancedCheck() {
  console.log('🔄 高度な整合性チェックを実行します...');
  
  try {
    // Balance Integrity Service を使用した包括的チェック
    const discrepancies = await balanceIntegrityService.performFullIntegrityCheck();
    
    console.log('\n' + '='.repeat(80));
    console.log('📋 高度な残高整合性チェック結果');
    console.log('='.repeat(80));
    
    if (discrepancies.length === 0) {
      console.log('✅ 不整合は検出されませんでした。全データソースで残高が一致しています。');
    } else {
      console.log(`🚨 ${discrepancies.length}件の不整合が検出されました:\n`);
      
      for (const discrepancy of discrepancies) {
        console.log(`[${discrepancy.currency}] 深刻度: ${discrepancy.severity}`);
        console.log(`  取引所残高: ${discrepancy.exchangeBalance}`);
        console.log(`  Redis残高: ${discrepancy.redisBalance}`);
        console.log(`  MongoDB残高: ${discrepancy.mongoBalance}`);
        console.log(`  最大乖離: ${discrepancy.discrepancies.max} (${discrepancy.discrepancyPercent.toFixed(2)}%)`);
        console.log();
      }
    }
    
    // メトリクス表示
    const metrics = balanceIntegrityService.getMetrics();
    console.log('📊 サービスメトリクス:');
    console.log(`  総チェック数: ${metrics.totalChecks}`);
    console.log(`  不整合検出数: ${metrics.discrepanciesFound}`);
    console.log(`  自動修正数: ${metrics.autoCorrections}`);
    console.log(`  失敗数: ${metrics.failedChecks}`);
    
  } catch (error) {
    console.error('高度なチェック中にエラーが発生:', error);
    throw error;
  }
}

/**
 * 監視モード
 */
async function runMonitoringMode() {
  console.log('🔄 監視モードを開始します...');
  
  try {
    await balanceMonitor.start();
    
    console.log('監視システムが開始されました。Ctrl+C で停止します。');
    
    // 終了シグナルの処理
    process.on('SIGINT', async () => {
      console.log('\n🛑 監視モードを停止します...');
      await balanceMonitor.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 監視モードを停止します...');
      await balanceMonitor.stop();
      process.exit(0);
    });
    
    // 無限ループで監視継続
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
  } catch (error) {
    console.error('監視モード中にエラーが発生:', error);
    throw error;
  }
}

/**
 * サービスモード
 */
async function runServiceMode() {
  console.log('🔄 サービスモードを開始します...');
  
  try {
    await balanceIntegrityService.start();
    
    console.log('Balance Integrity Service が開始されました。Ctrl+C で停止します。');
    
    // 終了シグナルの処理
    process.on('SIGINT', async () => {
      console.log('\n🛑 サービスモードを停止します...');
      await balanceIntegrityService.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 サービスモードを停止します...');
      await balanceIntegrityService.stop();
      process.exit(0);
    });
    
    // 無限ループでサービス継続
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
  } catch (error) {
    console.error('サービスモード中にエラーが発生:', error);
    throw error;
  }
}

/**
 * メトリクス表示
 */
async function showMetrics() {
  console.log('📊 システムメトリクスを表示します...');
  
  try {
    const integrityMetrics = balanceIntegrityService.getMetrics();
    const monitorStatus = balanceMonitor.getStatus();
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Balance Integrity Service メトリクス');
    console.log('='.repeat(60));
    
    console.log(`サービス状態: ${integrityMetrics.isRunning ? '✅ 稼働中' : '❌ 停止中'}`);
    console.log(`取引状態: ${integrityMetrics.tradingHalted ? '🛑 停止中' : '✅ 正常'}`);
    console.log(`総チェック数: ${integrityMetrics.totalChecks}`);
    console.log(`不整合検出数: ${integrityMetrics.discrepanciesFound}`);
    console.log(`自動修正数: ${integrityMetrics.autoCorrections}`);
    console.log(`失敗数: ${integrityMetrics.failedChecks}`);
    console.log(`連続失敗数: ${integrityMetrics.consecutiveFailures}`);
    console.log(`日次自動修正数: ${integrityMetrics.dailyAutoCorrections}`);
    console.log(`平均チェック時間: ${integrityMetrics.averageCheckTime.toFixed(2)}ms`);
    console.log(`キャッシュサイズ: ${integrityMetrics.cacheSize}`);
    console.log(`監査ログサイズ: ${integrityMetrics.auditLogSize}`);
    console.log(`最終チェック時刻: ${integrityMetrics.lastCheckTime || 'なし'}`);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Balance Monitor メトリクス');
    console.log('='.repeat(60));
    
    console.log(`監視状態: ${monitorStatus.isRunning ? '✅ 稼働中' : '❌ 停止中'}`);
    console.log(`連続失敗数: ${monitorStatus.consecutiveFailures}`);
    console.log(`実行中タスク数: ${monitorStatus.currentlyRunning}`);
    console.log(`総チェック数: ${monitorStatus.performanceStats.totalChecks}`);
    console.log(`成功チェック数: ${monitorStatus.performanceStats.successfulChecks}`);
    console.log(`失敗チェック数: ${monitorStatus.performanceStats.failedChecks}`);
    
    if (monitorStatus.performanceStats.totalChecks > 0) {
      const successRate = (monitorStatus.performanceStats.successfulChecks / monitorStatus.performanceStats.totalChecks) * 100;
      console.log(`成功率: ${successRate.toFixed(1)}%`);
    }
    
    console.log(`平均応答時間: ${monitorStatus.performanceStats.averageResponseTime.toFixed(2)}ms`);
    console.log(`最終チェック時刻: ${monitorStatus.performanceStats.lastCheckTime || 'なし'}`);
    console.log(`最終成功時刻: ${monitorStatus.performanceStats.lastSuccessTime || 'なし'}`);
    console.log(`最終失敗時刻: ${monitorStatus.performanceStats.lastFailureTime || 'なし'}`);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 アラート統計');
    console.log('='.repeat(60));
    
    console.log(`総アラート数: ${monitorStatus.alertStats.totalAlerts}`);
    console.log(`重要アラート数: ${monitorStatus.alertStats.criticalAlerts}`);
    console.log(`警告アラート数: ${monitorStatus.alertStats.warningAlerts}`);
    console.log(`最終アラート時刻: ${monitorStatus.alertStats.lastAlertTime || 'なし'}`);
    
    // 監査ログの最新エントリを表示
    const auditLog = balanceIntegrityService.getAuditLog(5);
    if (auditLog.length > 0) {
      console.log('\n' + '='.repeat(60));
      console.log('📋 最新の監査ログ (最新5件)');
      console.log('='.repeat(60));
      
      for (const entry of auditLog.reverse()) {
        console.log(`${entry.timestamp} - ${entry.action}`);
        if (entry.data && entry.data.currency) {
          console.log(`  通貨: ${entry.data.currency}`);
        }
        if (entry.data && entry.data.discrepancies !== undefined) {
          console.log(`  不整合数: ${entry.data.discrepancies}`);
        }
        console.log();
      }
    }
    
  } catch (error) {
    console.error('メトリクス取得中にエラーが発生:', error);
    throw error;
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { BalanceConsistencyChecker };