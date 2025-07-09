const { config } = require('../src/config');
const { initRedisClient } = require('../src/database/redisClient');
const { getStrategyPositionsRedis } = require('../src/database/redisDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

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

          const strategyAmount = openPositions.reduce((sum, pos) => sum + pos.amount, 0);

          if (strategyAmount > 0) {
            totalAmount += strategyAmount;
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
 * メイン実行関数
 */
async function main() {
  const checker = new BalanceConsistencyChecker();

  try {
    console.log('Redis接続を初期化中...');
    await initRedisClient();
    console.log('Redis接続完了\n');

    await checker.checkAllStrategies();

  } catch (error) {
    console.error('チェック実行エラー:', error);
    process.exit(1);
  } finally {
    console.log('🔍 残高整合性チェック完了');
    process.exit(0);
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { BalanceConsistencyChecker };