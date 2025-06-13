const { config } = require('../src/config');
const { 
  getStrategyPositionsRedis,
  recordPnLRedis,
  calculatePeriodPnLRedis 
} = require('../src/database/redisDatabase');
const { postOrderToDiscord, postErrorToDiscord } = require('../src/common/notifications');

// Redis接続を初期化
const { initRedisClient } = require('../src/database/redisClient');

/**
 * 残高整合性チェッカー
 * Redisで管理されているポジションと取引所の実際の残高を比較し、不整合を検出する
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
    console.log('🔍 残高整合性チェックを開始します...\n');
    
    const strategies = Object.keys(config.strategies).filter(key => 
      config.strategies[key].enabled
    );
    
    for (const strategyKey of strategies) {
      const strategyConfig = config.strategies[strategyKey];
      
      if (!strategyConfig.exchanges || strategyConfig.exchanges.length === 0) {
        continue;
      }
      
      for (const exchange of strategyConfig.exchanges) {
        await this.checkStrategyBalance(exchange, strategyKey);
      }
    }
    
    await this.generateReport();
  }

  /**
   * 特定戦略の残高をチェック
   */
  async checkStrategyBalance(exchange, strategyKey) {
    try {
      console.log(`📊 ${strategyKey} 戦略の残高をチェック中... (${exchange.id})`);
      
      // 取引所の実際の残高を取得
      const actualBalance = await exchange.fetchBalance();
      
      // 全通貨ペアを取得
      const markets = await exchange.fetchMarkets();
      const symbols = markets.map(market => market.symbol);
      
      // 通貨別のポジション残高を集計
      const positionBalances = await this.calculatePositionBalances(
        exchange.id, 
        strategyKey, 
        symbols
      );
      
      // 残高比較
      await this.compareBalances(
        exchange.id,
        strategyKey,
        actualBalance,
        positionBalances
      );
      
    } catch (error) {
      const warning = `⚠️ ${strategyKey} 戦略の残高チェックでエラー: ${error.message}`;
      this.warnings.push(warning);
      console.error(warning);
    }
  }

  /**
   * Redis上のポジションから残高を計算
   */
  async calculatePositionBalances(exchangeId, strategyKey, symbols) {
    const positionBalances = {};
    
    for (const symbol of symbols) {
      try {
        const positions = await getStrategyPositionsRedis(exchangeId, symbol, strategyKey);
        const openPositions = positions.filter(pos => pos.status === 'open' && pos.side === 'buy');
        
        if (openPositions.length > 0) {
          const baseAsset = symbol.split('/')[0];
          
          if (!positionBalances[baseAsset]) {
            positionBalances[baseAsset] = {
              total: 0,
              positions: []
            };
          }
          
          for (const position of openPositions) {
            positionBalances[baseAsset].total += position.amount;
            positionBalances[baseAsset].positions.push({
              symbol,
              orderId: position.orderId,
              amount: position.amount,
              entryPrice: position.entryPrice,
              createdAt: new Date(position.createdAt).toLocaleString('ja-JP')
            });
          }
        }
        
      } catch (error) {
        console.warn(`ポジション取得エラー: ${symbol} - ${error.message}`);
      }
    }
    
    return positionBalances;
  }

  /**
   * 実残高とポジション残高を比較
   */
  async compareBalances(exchangeId, strategyKey, actualBalance, positionBalances) {
    const currencies = new Set([
      ...Object.keys(actualBalance.free || {}),
      ...Object.keys(positionBalances)
    ]);

    for (const currency of currencies) {
      const actualFree = actualBalance.free[currency] || 0;
      const actualUsed = actualBalance.used[currency] || 0;
      const actualTotal = actualBalance.total[currency] || 0;
      const positionTotal = positionBalances[currency]?.total || 0;

      // 最小量閾値（0.0001未満は無視）
      const threshold = 0.0001;
      
      if (positionTotal > threshold || actualTotal > threshold) {
        this.totalChecked++;
        
        const discrepancy = Math.abs(positionTotal - actualUsed);
        const discrepancyPercent = actualUsed > 0 ? (discrepancy / actualUsed) * 100 : 0;
        
        // 1%以上の乖離または0.001以上の絶対差がある場合は警告
        if (discrepancy > 0.001 && discrepancyPercent > 1) {
          const issue = {
            exchangeId,
            strategyKey,
            currency,
            actualFree,
            actualUsed,
            actualTotal,
            positionTotal,
            discrepancy,
            discrepancyPercent: discrepancyPercent.toFixed(2),
            positions: positionBalances[currency]?.positions || []
          };
          
          this.discrepancies.push(issue);
          
          console.log(`❌ 不整合検出: ${exchangeId} ${strategyKey} ${currency}`);
          console.log(`   実残高: ${actualUsed.toFixed(6)} (使用中) / ${actualTotal.toFixed(6)} (合計)`);
          console.log(`   ポジション合計: ${positionTotal.toFixed(6)}`);
          console.log(`   乖離: ${discrepancy.toFixed(6)} (${discrepancyPercent.toFixed(2)}%)\n`);
        } else {
          console.log(`✅ ${currency}: 整合性OK (実: ${actualUsed.toFixed(6)}, ポジション: ${positionTotal.toFixed(6)})`);
        }
      }
    }
  }

  /**
   * 詳細レポートを生成
   */
  async generateReport() {
    console.log('\n' + '='.repeat(80));
    console.log('📋 残高整合性チェック結果レポート');
    console.log('='.repeat(80));
    
    console.log(`📊 チェック件数: ${this.totalChecked}件`);
    console.log(`❌ 不整合件数: ${this.discrepancies.length}件`);
    console.log(`⚠️ 警告件数: ${this.warnings.length}件\n`);

    if (this.discrepancies.length > 0) {
      console.log('🚨 検出された不整合:');
      console.log('-'.repeat(60));
      
      for (const issue of this.discrepancies) {
        console.log(`\n[${issue.exchangeId}] ${issue.strategyKey} - ${issue.currency}`);
        console.log(`  実残高(使用中): ${issue.actualUsed}`);
        console.log(`  ポジション合計: ${issue.positionTotal}`);
        console.log(`  乖離: ${issue.discrepancy} (${issue.discrepancyPercent}%)`);
        
        if (issue.positions.length > 0) {
          console.log(`  関連ポジション:`);
          for (const pos of issue.positions) {
            console.log(`    - ${pos.symbol}: ${pos.amount} (注文ID: ${pos.orderId}, エントリー: ${pos.entryPrice}, 作成: ${pos.createdAt})`);
          }
        }
      }
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
    console.log('チェック完了');
    console.log('='.repeat(80));
  }

  /**
   * Discord通知を送信
   */
  async sendDiscordNotification() {
    const severity = this.discrepancies.length > 0 ? '🚨' : '✅';
    const status = this.discrepancies.length > 0 ? '不整合検出' : '正常';
    
    let message = `${severity} [残高整合性チェック] ${status}\n\n`;
    message += `📊 チェック件数: ${this.totalChecked}件\n`;
    message += `❌ 不整合件数: ${this.discrepancies.length}件\n`;
    message += `⚠️ 警告件数: ${this.warnings.length}件\n`;
    message += `🕐 実行時刻: ${new Date().toLocaleString('ja-JP')}\n`;

    if (this.discrepancies.length > 0) {
      message += '\n🚨 主要な不整合:\n';
      // 上位5件の不整合を表示
      const topIssues = this.discrepancies
        .sort((a, b) => parseFloat(b.discrepancyPercent) - parseFloat(a.discrepancyPercent))
        .slice(0, 5);
      
      for (const issue of topIssues) {
        message += `• ${issue.exchangeId} ${issue.strategyKey} ${issue.currency}: ${issue.discrepancyPercent}%乖離\n`;
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

  /**
   * 特定通貨ペアの詳細チェック
   */
  async checkSpecificSymbol(exchangeId, symbol, strategyKey) {
    console.log(`🔍 ${symbol} の詳細チェックを実行中...`);
    
    try {
      const exchange = config.exchanges[exchangeId]?.instance;
      if (!exchange) {
        throw new Error(`取引所 ${exchangeId} が見つかりません`);
      }

      const actualBalance = await exchange.fetchBalance();
      const positions = await getStrategyPositionsRedis(exchangeId, symbol, strategyKey);
      const baseAsset = symbol.split('/')[0];

      console.log(`\n📊 ${symbol} (${strategyKey}) の詳細:`);
      console.log(`実残高: ${actualBalance.free[baseAsset] || 0} (Free) / ${actualBalance.used[baseAsset] || 0} (Used)`);
      console.log(`ポジション数: ${positions.length}件`);

      const openPositions = positions.filter(pos => pos.status === 'open');
      if (openPositions.length > 0) {
        console.log(`\nオープンポジション:`);
        for (const pos of openPositions) {
          console.log(`  注文ID ${pos.orderId}: ${pos.amount} @ ${pos.entryPrice} (${new Date(pos.createdAt).toLocaleString('ja-JP')})`);
        }
        
        const totalAmount = openPositions.reduce((sum, pos) => sum + pos.amount, 0);
        console.log(`ポジション合計: ${totalAmount}`);
        
        const usedBalance = actualBalance.used[baseAsset] || 0;
        const discrepancy = Math.abs(totalAmount - usedBalance);
        console.log(`乖離: ${discrepancy} (${usedBalance > 0 ? (discrepancy/usedBalance*100).toFixed(2) : 'N/A'}%)`);
      }

    } catch (error) {
      console.error(`詳細チェックエラー: ${error.message}`);
    }
  }
}

/**
 * メイン実行関数
 */
async function main() {
  const args = process.argv.slice(2);
  const checker = new BalanceConsistencyChecker();

  try {
    // Redis接続を初期化
    console.log('Redis接続を初期化中...');
    await initRedisClient();
    console.log('Redis接続完了\n');

    if (args.length === 3) {
      // 特定通貨ペアのチェック
      const [exchangeId, symbol, strategyKey] = args;
      await checker.checkSpecificSymbol(exchangeId, symbol, strategyKey);
    } else {
      // 全戦略のチェック
      await checker.checkAllStrategies();
    }
  } catch (error) {
    console.error('チェック実行エラー:', error);
    process.exit(1);
  }
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { BalanceConsistencyChecker };