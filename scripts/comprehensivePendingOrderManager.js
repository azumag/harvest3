const ccxt = require('ccxt');
const redis = require('redis');
const OrderValidation = require('../src/common/orderValidation');
const MarketPriceTracker = require('../src/common/marketPriceTracker');
const PendingOrderLimitManager = require('../src/common/pendingOrderLimitManager');

class ComprehensivePendingOrderManager {
  constructor() {
    this.client = null;
    this.exchange = null;
    this.validator = null;
    this.priceTracker = null;
    this.limitManager = null;
  }

  async init() {
    // Redis接続
    this.client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    await this.client.connect();

    // 取引所接続
    this.exchange = new ccxt.bitbank({
      apiKey: process.env.BITBANK_API_KEY,
      secret: process.env.BITBANK_API_SECRET,
      sandbox: false
    });

    // 各コンポーネント初期化
    this.validator = new OrderValidation(this.exchange);
    this.priceTracker = new MarketPriceTracker(this.exchange, this.client);
    this.limitManager = new PendingOrderLimitManager(this.exchange, this.client);

    console.log('✅ 包括的未約定注文管理システム初期化完了');
  }

  async close() {
    if (this.client) {
      await this.client.quit();
    }
  }

  // 包括的診断
  async performComprehensiveDiagnosis() {
    console.log('\n🔍 === 包括的診断開始 ===\n');

    // 1. 基本統計
    const stats = await this.limitManager.getCurrentStats();
    console.log('📊 **基本統計**');
    console.log(`  総未約定注文数: ${stats.total}件`);
    console.log(`  買い注文比率: ${(stats.buyRatio * 100).toFixed(1)}%`);
    console.log(`  平均注文年齢: ${(stats.avgOrderAge / (60 * 60 * 1000)).toFixed(1)}時間`);
    console.log(`  総注文価値: ¥${stats.totalValue.toLocaleString()}`);

    // 2. 制限違反検出
    const violations = await this.limitManager.detectLimitViolations();
    console.log(`\n⚠️ **制限違反**: ${violations.length}件`);
    if (violations.length > 0) {
      const highSeverity = violations.filter(v => v.severity === 'high');
      const mediumSeverity = violations.filter(v => v.severity === 'medium');

      if (highSeverity.length > 0) {
        console.log(`  🔴 高優先度: ${highSeverity.length}件`);
        highSeverity.forEach(v => console.log(`    - ${v.message}`));
      }
      if (mediumSeverity.length > 0) {
        console.log(`  🟡 中優先度: ${mediumSeverity.length}件`);
        mediumSeverity.slice(0, 5).forEach(v => console.log(`    - ${v.message}`));
        if (mediumSeverity.length > 5) {
          console.log(`    ... 他 ${mediumSeverity.length - 5} 件`);
        }
      }
    }

    // 3. ヘルスチェック
    const health = await this.limitManager.healthCheck();
    console.log(`\n💊 **システム健全性**: ${health.status === 'healthy' ? '✅ 健全' : '⚠️ 要注意'}`);
    console.log(`  利用率: ${health.utilization}`);
    console.log(`  緊急モード: ${health.emergencyMode ? 'ON 🚨' : 'OFF'}`);

    // 4. 問題の優先度評価
    const urgency = this.calculateUrgencyLevel(stats, violations, health);
    console.log(`\n🚨 **緊急度**: ${urgency.level} (${urgency.score}/100)`);
    console.log(`  判定理由: ${urgency.reasons.join(', ')}`);

    return { stats, violations, health, urgency };
  }

  // 緊急度レベルの計算
  calculateUrgencyLevel(stats, violations, health) {
    let score = 0;
    const reasons = [];

    // 利用率による評価
    const utilization = stats.total / this.limitManager.limits.maxTotalPendingOrders;
    if (utilization > 2.0) {
      score += 40;
      reasons.push('利用率200%超過');
    } else if (utilization > 1.5) {
      score += 30;
      reasons.push('利用率150%超過');
    } else if (utilization > 1.0) {
      score += 20;
      reasons.push('利用率100%超過');
    }

    // 買い注文比率による評価
    if (stats.buyRatio > 0.95) {
      score += 30;
      reasons.push('買い注文95%超過');
    } else if (stats.buyRatio > 0.90) {
      score += 20;
      reasons.push('買い注文90%超過');
    } else if (stats.buyRatio > 0.80) {
      score += 10;
      reasons.push('買い注文80%超過');
    }

    // 古い注文による評価
    if (stats.byAge.ancient > 50) {
      score += 20;
      reasons.push('古い注文50件超過');
    } else if (stats.byAge.ancient > 20) {
      score += 10;
      reasons.push('古い注文20件超過');
    }

    // 制限違反による評価
    const highViolations = violations.filter(v => v.severity === 'high').length;
    score += highViolations * 5;
    if (highViolations > 0) {
      reasons.push(`高優先度違反${highViolations}件`);
    }

    // レベル判定
    let level;
    if (score >= 70) {
      level = '🚨 緊急';
    } else if (score >= 40) {
      level = '⚠️ 高';
    } else if (score >= 20) {
      level = '🟡 中';
    } else {
      level = '✅ 低';
    }

    return { score, level, reasons };
  }

  // 自動修復の実行
  async performAutoRemediation(options = {}) {
    const { dryRun = false, maxCleanup = 50 } = options;

    console.log('\n🔧 === 自動修復開始 ===\n');

    if (dryRun) {
      console.log('⚠️ ドライランモード - 実際の変更は行いません\n');
    }

    const results = {
      diagnosis: null,
      cleanup: null,
      priceAdjustment: null,
      summary: {
        success: false,
        totalActions: 0,
        errors: []
      }
    };

    try {
      // 1. 診断実行
      results.diagnosis = await this.performComprehensiveDiagnosis();

      // 2. 緊急度に応じた対応
      const urgency = results.diagnosis.urgency;

      if (urgency.score >= 40) {
        console.log('\n🚨 高緊急度 - 即座の対応が必要');

        // 緊急クリーンアップ実行
        if (!dryRun) {
          console.log('\n🔧 緊急クリーンアップ実行中...');
          results.cleanup = await this.limitManager.performAutoCleanup();
          results.summary.totalActions += results.cleanup.cleaned || 0;
        } else {
          console.log('\n[ドライラン] 緊急クリーンアップ対象を特定...');
          results.cleanup = await this.identifyCleanupTargets();
        }

      } else if (urgency.score >= 20) {
        console.log('\n⚠️ 中緊急度 - 予防的対応を実行');

        // 価格調整による最適化
        const topSymbols = Object.entries(results.diagnosis.stats.bySymbol)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([symbol]) => symbol);

        console.log(`\n📈 価格調整対象: ${topSymbols.join(', ')}`);

        if (!dryRun) {
          results.priceAdjustment = await this.priceTracker.adjustMultipleSymbols(topSymbols);
          const adjustedCount = Object.values(results.priceAdjustment).reduce((sum, r) => sum + (r.adjusted || 0), 0);
          results.summary.totalActions += adjustedCount;
        } else {
          console.log('[ドライラン] 価格調整をシミュレーション');
          results.priceAdjustment = { simulated: true };
        }

      } else {
        console.log('\n✅ 低緊急度 - 監視継続');
      }

      // 3. 修復後の検証
      if (!dryRun && results.summary.totalActions > 0) {
        console.log('\n🔍 修復後検証...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5秒待機

        const postStats = await this.limitManager.getCurrentStats();
        const improvement = {
          totalReduction: results.diagnosis.stats.total - postStats.total,
          buyRatioImprovement: results.diagnosis.stats.buyRatio - postStats.buyRatio
        };

        console.log('\n📊 修復効果:');
        console.log(`  注文数削減: ${improvement.totalReduction}件`);
        console.log(`  買い比率改善: ${(improvement.buyRatioImprovement * 100).toFixed(1)}%`);

        results.summary.improvement = improvement;
      }

      results.summary.success = true;

    } catch (error) {
      console.error('❌ 自動修復エラー:', error);
      results.summary.errors.push(error.message);
    }

    // 4. 結果サマリー
    console.log('\n📋 === 修復結果サマリー ===');
    console.log(`実行モード: ${dryRun ? 'ドライラン' : '実行'}`);
    console.log(`総アクション数: ${results.summary.totalActions}`);
    console.log(`成功: ${results.summary.success ? '✅' : '❌'}`);

    if (results.summary.errors.length > 0) {
      console.log(`エラー数: ${results.summary.errors.length}`);
      results.summary.errors.forEach(err => console.log(`  - ${err}`));
    }

    return results;
  }

  // クリーンアップ対象の特定（ドライラン用）
  async identifyCleanupTargets() {
    const allKeys = await this.client.keys('pending_order:*');
    const targets = {
      oldOrders: 0,
      excessiveSymbols: 0,
      buyOrderReduction: 0
    };

    const now = Date.now();
    const symbolCounts = {};
    let buyCount = 0;

    for (const key of allKeys) {
      const orderData = await this.client.hGetAll(key);
      const timestamp = parseInt(orderData.timestamp) || now;
      const age = now - timestamp;

      // 古い注文
      if (age > this.limitManager.limits.maxOrderAge) {
        targets.oldOrders++;
      }

      // シンボル別集計
      const symbol = orderData.symbol;
      if (symbol) {
        symbolCounts[symbol] = (symbolCounts[symbol] || 0) + 1;
      }

      // 買い注文
      if (orderData.side === 'buy') {
        buyCount++;
      }
    }

    // 過多シンボル
    for (const [symbol, count] of Object.entries(symbolCounts)) {
      if (count > this.limitManager.limits.maxPendingOrdersPerSymbol) {
        targets.excessiveSymbols += count - this.limitManager.limits.maxPendingOrdersPerSymbol;
      }
    }

    // 買い注文削減
    const totalOrders = allKeys.length;
    const targetBuyCount = Math.floor(totalOrders * this.limitManager.limits.maxBuyRatio);
    targets.buyOrderReduction = Math.max(0, buyCount - targetBuyCount);

    return targets;
  }

  // 新規注文前チェック
  async preOrderValidation(symbol, side, price, amount) {
    console.log(`\n🔍 注文前チェック: ${symbol} ${side} ¥${price.toLocaleString()} x ${amount}`);

    // 1. 基本バリデーション
    const validation = await this.validator.validateOrder(this.client, symbol, side, price, amount);

    // 2. 上限チェック
    const limitCheck = await this.limitManager.canCreateNewOrder(symbol, side, price, amount);

    // 3. 推奨価格との比較
    try {
      const recommendedPrice = await this.validator.getRecommendedPrice(symbol, side);
      const priceDeviation = Math.abs((price - recommendedPrice) / recommendedPrice);

      const result = {
        validation,
        limitCheck,
        priceRecommendation: {
          recommended: recommendedPrice,
          deviation: priceDeviation,
          acceptable: priceDeviation < 0.03 // 3%以内
        },
        overall: validation.valid && limitCheck.allowed && priceDeviation < 0.03
      };

      console.log(`結果: ${result.overall ? '✅ 承認' : '❌ 拒否'}`);
      if (!result.overall) {
        if (!validation.valid) {
          console.log(`  バリデーション: ${validation.summary}`);
        }
        if (!limitCheck.allowed) {
          console.log(`  上限チェック: ${limitCheck.reason}`);
        }
        if (!result.priceRecommendation.acceptable) {
          console.log(`  価格推奨: ¥${recommendedPrice.toLocaleString()} (乖離: ${(priceDeviation * 100).toFixed(1)}%)`);
        }
      }

      return result;

    } catch (error) {
      console.error('価格推奨取得エラー:', error);
      return {
        validation,
        limitCheck,
        overall: validation.valid && limitCheck.allowed
      };
    }
  }
}

// コマンドライン実行
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'diagnose';
  const dryRun = args.includes('--dry-run');
  const maxCleanup = parseInt(args.find(arg => arg.startsWith('--max='))?.split('=')[1]) || 50;

  const manager = new ComprehensivePendingOrderManager();
  await manager.init();

  try {
    switch (command) {
    case 'diagnose':
      await manager.performComprehensiveDiagnosis();
      break;

    case 'fix':
      await manager.performAutoRemediation({ dryRun, maxCleanup });
      break;

    case 'validate':
      // 例: node script.js validate BTC/JPY buy 15000000 0.001
      const [, symbol, side, price, amount] = args;
      if (symbol && side && price && amount) {
        await manager.preOrderValidation(symbol, side, parseFloat(price), parseFloat(amount));
      } else {
        console.log('使用方法: node script.js validate <symbol> <side> <price> <amount>');
      }
      break;

    default:
      console.log(`
🔧 包括的未約定注文管理システム

使用方法:
  node ${process.argv[1].split('/').pop()} diagnose              # 診断のみ実行
  node ${process.argv[1].split('/').pop()} fix [--dry-run]       # 自動修復実行
  node ${process.argv[1].split('/').pop()} validate <args>       # 注文前チェック

オプション:
  --dry-run         実際の変更を行わずシミュレーション
  --max=N          最大処理件数を指定

例:
  node ${process.argv[1].split('/').pop()} diagnose
  node ${process.argv[1].split('/').pop()} fix --dry-run
  node ${process.argv[1].split('/').pop()} fix --max=30
  node ${process.argv[1].split('/').pop()} validate BTC/JPY buy 15000000 0.001
                `);
    }
  } finally {
    await manager.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ComprehensivePendingOrderManager;