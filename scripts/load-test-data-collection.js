#!/usr/bin/env node

/**
 * 統計的有意性を確保するための大量データ収集シミュレーター
 * 実運用環境を模した様々なシナリオでのデータ収集
 */

const RealDataCollectorEnhanced = require('../src/monitoring/realDataCollectorEnhanced');
const fs = require('fs');
const path = require('path');

// 実環境を模したモック取引所
class RealisticMockExchange {
  constructor(id, profile = 'normal') {
    this.id = id;
    this.markets = this.generateMarkets();
    this.rateLimit = 1000;
    this.enableRateLimit = true;
    this.timeout = 30000;
    this.throttle = { queue: [] };

    // プロファイルに基づく挙動設定
    this.profile = this.loadProfile(profile);
    this.callCount = 0;
    this.lastCallTime = Date.now();
  }

  generateMarkets() {
    const pairs = ['BTC/USDT', 'ETH/USDT', 'XRP/USDT', 'ADA/USDT', 'DOT/USDT'];
    const markets = {};
    pairs.forEach(pair => {
      markets[pair] = {
        symbol: pair,
        base: pair.split('/')[0],
        quote: pair.split('/')[1]
      };
    });
    return markets;
  }

  loadProfile(profileName) {
    const profiles = {
      // 正常な取引所
      normal: {
        baseResponseTime: 150,
        responseTimeVariance: 50,
        successRate: 0.98,
        errorDistribution: {
          timeout: 0.3,
          network: 0.2,
          rate_limit: 0.4,
          invalid_response: 0.1
        },
        loadPattern: 'steady'
      },

      // 高負荷な取引所
      high_load: {
        baseResponseTime: 500,
        responseTimeVariance: 300,
        successRate: 0.85,
        errorDistribution: {
          timeout: 0.5,
          rate_limit: 0.3,
          network: 0.1,
          invalid_response: 0.1
        },
        loadPattern: 'spiky'
      },

      // 不安定な取引所
      unstable: {
        baseResponseTime: 200,
        responseTimeVariance: 500,
        successRate: 0.70,
        errorDistribution: {
          network: 0.4,
          timeout: 0.3,
          invalid_response: 0.2,
          rate_limit: 0.1
        },
        loadPattern: 'random'
      },

      // メンテナンス中の取引所
      maintenance: {
        baseResponseTime: 100,
        responseTimeVariance: 10,
        successRate: 0.05,
        errorDistribution: {
          authentication: 0.8,
          network: 0.2
        },
        loadPattern: 'steady'
      }
    };

    return profiles[profileName] || profiles.normal;
  }

  async fetchStatus() {
    return this.simulateApiCall('fetchStatus');
  }

  async fetchTime() {
    return this.simulateApiCall('fetchTime');
  }

  async fetchTicker(symbol) {
    return this.simulateApiCall('fetchTicker', { symbol });
  }

  async simulateApiCall(method, params = {}) {
    this.callCount++;

    // 負荷パターンのシミュレーション
    const responseTime = this.calculateResponseTime();

    // 応答時間のシミュレート
    await new Promise(resolve => setTimeout(resolve, responseTime));

    // 成功/失敗の決定
    if (Math.random() > this.profile.successRate) {
      // エラーの種類を決定
      const errorType = this.selectErrorType();
      throw this.createError(errorType);
    }

    // キューサイズのシミュレート（負荷に応じて）
    this.updateQueueSize();

    // 成功レスポンス
    return {
      status: 'ok',
      timestamp: Date.now(),
      method,
      params,
      exchange: this.id,
      responseTime
    };
  }

  calculateResponseTime() {
    const { baseResponseTime, responseTimeVariance, loadPattern } = this.profile;
    let multiplier = 1;

    // 負荷パターンに基づく調整
    switch (loadPattern) {
    case 'spiky':
      // 時々スパイクが発生
      if (Math.random() < 0.1) {
        multiplier = 3 + Math.random() * 2;
      }
      break;

    case 'random':
      // ランダムな変動
      multiplier = 0.5 + Math.random() * 2;
      break;

    case 'steady':
      // 安定した応答
      multiplier = 0.9 + Math.random() * 0.2;
      break;
    }

    // 時間帯による変動（ビジネス時間は遅い）
    const hour = new Date().getHours();
    if (hour >= 9 && hour <= 17) {
      multiplier *= 1.2;
    }

    const variance = (Math.random() - 0.5) * responseTimeVariance;
    return Math.max(10, (baseResponseTime + variance) * multiplier);
  }

  selectErrorType() {
    const random = Math.random();
    let cumulative = 0;

    for (const [type, probability] of Object.entries(this.profile.errorDistribution)) {
      cumulative += probability;
      if (random < cumulative) {
        return type;
      }
    }

    return 'unknown';
  }

  createError(type) {
    const errors = {
      timeout: new Error('Request timeout after 10000ms'),
      network: new Error('ENOTFOUND api.exchange.com'),
      rate_limit: new Error('Rate limit exceeded: 429'),
      invalid_response: new Error('Unexpected token < in JSON at position 0'),
      authentication: new Error('Invalid API key or permissions'),
      unknown: new Error('Internal server error')
    };

    return errors[type] || errors.unknown;
  }

  updateQueueSize() {
    // 呼び出し頻度に基づくキューサイズのシミュレート
    const timeSinceLastCall = Date.now() - this.lastCallTime;
    this.lastCallTime = Date.now();

    if (timeSinceLastCall < 100) {
      // 高頻度呼び出し
      this.throttle.queue.length = Math.min(50, this.throttle.queue.length + 5);
    } else if (timeSinceLastCall > 1000) {
      // 低頻度
      this.throttle.queue.length = Math.max(0, this.throttle.queue.length - 10);
    }
  }
}

// データ収集シナリオ
class DataCollectionScenario {
  constructor(name, duration, exchanges) {
    this.name = name;
    this.duration = duration;
    this.exchanges = exchanges;
    this.startTime = null;
    this.endTime = null;
  }

  async run(collector) {
    console.log(`\n🎬 シナリオ開始: ${this.name}`);
    console.log(`期間: ${this.duration / 1000}秒`);
    console.log(`取引所: ${this.exchanges.map(e => `${e.id}(${e.profile.loadPattern})`).join(', ')}`);

    this.startTime = Date.now();

    collector.startCollection(this.exchanges);

    // 進捗表示
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - this.startTime;
      const progress = (elapsed / this.duration) * 100;
      const stats = collector.getRealtimeStatistics();

      console.log(`進捗: ${progress.toFixed(1)}% | データ: ${stats.totalDataPoints}件 | 成功率: ${(stats.successRate * 100).toFixed(1)}%`);
    }, 5000);

    // 指定期間待機
    await new Promise(resolve => setTimeout(resolve, this.duration));

    clearInterval(progressInterval);
    collector.stopCollection();

    this.endTime = Date.now();

    return this.generateReport(collector);
  }

  generateReport(collector) {
    const stats = collector.getRealtimeStatistics();
    const duration = (this.endTime - this.startTime) / 1000;

    return {
      scenario: this.name,
      duration: `${duration}秒`,
      results: {
        totalDataPoints: stats.totalDataPoints,
        dataPointsPerSecond: (stats.totalDataPoints / duration).toFixed(2),
        successRate: `${(stats.successRate * 100).toFixed(2)}%`,
        errorRate: `${(stats.errorRate * 100).toFixed(2)}%`,
        totalErrors: stats.totalErrors,
        errorTypes: stats.errorTypes,
        responseTimeStats: stats.responseTimeStats,
        memoryStats: stats.memoryStats
      }
    };
  }
}

// メインの負荷テスト実行
async function runLoadTest() {
  console.log('🚀 大規模データ収集負荷テスト開始\n');

  const dataDir = path.join(__dirname, '../data/load-test');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // シナリオ定義
  const scenarios = [
    // シナリオ1: 通常運用（5分間）
    new DataCollectionScenario('通常運用シミュレーション', 5 * 60 * 1000, [
      new RealisticMockExchange('binance', 'normal'),
      new RealisticMockExchange('bybit', 'normal'),
      new RealisticMockExchange('okx', 'normal')
    ]),

    // シナリオ2: 高負荷時（3分間）
    new DataCollectionScenario('高負荷シミュレーション', 3 * 60 * 1000, [
      new RealisticMockExchange('binance', 'high_load'),
      new RealisticMockExchange('bybit', 'high_load'),
      new RealisticMockExchange('okx', 'normal')
    ]),

    // シナリオ3: 障害発生時（2分間）
    new DataCollectionScenario('障害シミュレーション', 2 * 60 * 1000, [
      new RealisticMockExchange('binance', 'unstable'),
      new RealisticMockExchange('bybit', 'maintenance'),
      new RealisticMockExchange('okx', 'high_load')
    ]),

    // シナリオ4: 混合環境（5分間）
    new DataCollectionScenario('混合環境シミュレーション', 5 * 60 * 1000, [
      new RealisticMockExchange('binance', 'normal'),
      new RealisticMockExchange('bybit', 'unstable'),
      new RealisticMockExchange('okx', 'high_load'),
      new RealisticMockExchange('kraken', 'normal'),
      new RealisticMockExchange('huobi', 'unstable')
    ])
  ];

  const allReports = [];

  // 各シナリオを順次実行
  for (const scenario of scenarios) {
    const collector = new RealDataCollectorEnhanced({
      collectionInterval: 1000, // 1秒間隔で高頻度収集
      dataFile: path.join(dataDir, `${scenario.name.replace(/\s+/g, '-')}.json`),
      errorLogFile: path.join(dataDir, `${scenario.name.replace(/\s+/g, '-')}-errors.json`),
      apiTimeout: 5000,
      maxRetries: 2,
      retryDelay: 500
    });

    const report = await scenario.run(collector);
    allReports.push(report);

    // シナリオ間で少し待機
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // 総合レポート生成
  generateFinalReport(allReports, dataDir);
}

// 最終レポート生成
function generateFinalReport(reports, dataDir) {
  console.log('\n📊 負荷テスト最終レポート');
  console.log('========================\n');

  let totalDataPoints = 0;
  let totalErrors = 0;
  const allResponseTimes = [];
  const errorTypeSummary = {};

  reports.forEach(report => {
    console.log(`## ${report.scenario}`);
    console.log(`- 実行時間: ${report.duration}`);
    console.log(`- データポイント: ${report.results.totalDataPoints}件`);
    console.log(`- 成功率: ${report.results.successRate}`);
    console.log(`- エラー率: ${report.results.errorRate}`);

    if (report.results.responseTimeStats) {
      console.log('- 応答時間:');
      console.log(`  - P50: ${report.results.responseTimeStats.p50}ms`);
      console.log(`  - P90: ${report.results.responseTimeStats.p90}ms`);
      console.log(`  - P95: ${report.results.responseTimeStats.p95}ms`);
      console.log(`  - P99: ${report.results.responseTimeStats.p99}ms`);
    }

    console.log('');

    totalDataPoints += report.results.totalDataPoints;
    totalErrors += report.results.totalErrors;

    // エラータイプの集計
    Object.entries(report.results.errorTypes || {}).forEach(([type, count]) => {
      errorTypeSummary[type] = (errorTypeSummary[type] || 0) + count;
    });
  });

  console.log('## 総合統計');
  console.log(`- 総データポイント: ${totalDataPoints}件`);
  console.log(`- 総エラー数: ${totalErrors}件`);
  console.log(`- 全体エラー率: ${((totalErrors / (totalDataPoints * 3)) * 100).toFixed(2)}%`);

  console.log('\n## エラー種別分析');
  Object.entries(errorTypeSummary).forEach(([type, count]) => {
    const percentage = ((count / totalErrors) * 100).toFixed(1);
    console.log(`- ${type}: ${count}件 (${percentage}%)`);
  });

  // レポートファイル保存
  const finalReport = {
    timestamp: new Date().toISOString(),
    scenarios: reports,
    summary: {
      totalDataPoints,
      totalErrors,
      overallErrorRate: (totalErrors / (totalDataPoints * 3)) * 100,
      errorTypeSummary
    }
  };

  fs.writeFileSync(
    path.join(dataDir, 'load-test-final-report.json'),
    JSON.stringify(finalReport, null, 2)
  );

  console.log('\n✅ 負荷テスト完了');
  console.log(`📁 詳細データ: ${dataDir}`);
  console.log(`\n統計的有意性: ${totalDataPoints >= 1000 ? '✅ 達成' : '❌ 未達成'} (${totalDataPoints}/1000件)`);
}

// 実行
if (require.main === module) {
  runLoadTest().catch(error => {
    console.error('❌ 負荷テストエラー:', error);
    process.exit(1);
  });
}

module.exports = { RealisticMockExchange, DataCollectionScenario };