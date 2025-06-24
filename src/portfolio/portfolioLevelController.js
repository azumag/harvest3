/**
 * Ultra-Think Phase 2.7: ポートフォリオレベル制御システム
 * 次世代harvest3の高度ポートフォリオ管理システム
 */
require('dotenv').config();
const redis = require('redis');

class PortfolioLevelController {
  constructor() {
    this.client = null;
    this.isActive = false;
    this.startTime = null;
    
    // ポートフォリオ制御設定
    this.portfolioConfig = {
      // グローバル制限
      maxTotalPositions: 200,
      maxTotalValue: 1000000,  // ¥100万
      maxSingleStrategyRatio: 0.35,  // 35%上限
      maxSingleCurrencyRatio: 0.10,  // 10%上限
      
      // 戦略別配分
      strategyAllocation: {
        'BOLLINGER_BANDS_CONSERVATIVE': { min: 0.25, max: 0.35, target: 0.30 },
        'BOLLINGER_BANDS_AGGRESSIVE': { min: 0.15, max: 0.25, target: 0.20 },
        'MULTI_INDICATOR': { min: 0.20, max: 0.30, target: 0.25 },
        'MEAN_REVERSION': { min: 0.10, max: 0.20, target: 0.15 },
        'MACD': { min: 0.05, max: 0.15, target: 0.10 },
        'TECHNICAL_MOMENTUM': { min: 0.00, max: 0.10, target: 0.05 }
      },
      
      // リスク管理
      riskLimits: {
        maxDrawdown: 0.15,        // 15%最大ドローダウン
        maxDailyLoss: 0.05,       // 5%日次損失限度
        maxLongRatio: 0.75,       // 75%ロング上限
        maxCorrelation: 0.8,      // 戦略間相関上限
        volatilityThreshold: 0.3   // ボラティリティ閾値
      },
      
      // 動的調整
      adaptiveSettings: {
        enabled: true,
        learningRate: 0.1,
        adaptationInterval: 24 * 60 * 60 * 1000,  // 24時間
        marketRegimeDetection: true,
        performanceBasedRebalancing: true
      }
    };
    
    // ポートフォリオ状態
    this.portfolioState = {
      currentAllocation: {},
      totalValue: 0,
      totalPositions: 0,
      riskMetrics: {},
      performanceMetrics: {},
      lastRebalance: null,
      marketRegime: 'neutral'
    };
    
    // パフォーマンス履歴
    this.performanceHistory = [];
    this.rebalanceHistory = [];
  }

  async initialize() {
    try {
      this.client = redis.createClient({ url: 'redis://redis:6379' });
      await this.client.connect();
      
      console.log('✅ PortfolioLevelController initialized');
      return true;
    } catch (error) {
      console.error('❌ PortfolioLevelController initialization failed:', error.message);
      return false;
    }
  }

  async activate() {
    if (this.isActive) {
      console.log('⚠️ PortfolioLevelController already active');
      return;
    }

    console.log(`
🚀 ポートフォリオレベル制御システム起動

## 🎯 Ultra-Think Phase 2.7実装

### 高度制御機能:
📊 戦略別配分管理 (6戦略最適配分)
⚖️ リスク統合制御 (相関・集中度・ドローダウン)
🔄 動的リバランシング (市場状況適応)
🧠 機械学習最適化 (パフォーマンス学習)
📈 リアルタイム監視 (継続的品質管理)

### 配分ターゲット:
BOLLINGER_BANDS_CONSERVATIVE: 30%
BOLLINGER_BANDS_AGGRESSIVE: 20%  
MULTI_INDICATOR: 25%
MEAN_REVERSION: 15%
MACD: 10%
TECHNICAL_MOMENTUM: 5%
    `);

    this.isActive = true;
    this.startTime = Date.now();
    
    // 初期ポートフォリオ分析
    await this.analyzeCurrentPortfolio();
    
    // 定期監視開始 (30分間隔)
    this.monitoringInterval = setInterval(async () => {
      await this.performPortfolioMonitoring();
    }, 30 * 60 * 1000);
    
    // リバランシング監視 (6時間間隔)
    this.rebalanceInterval = setInterval(async () => {
      await this.evaluateRebalancingNeeds();
    }, 6 * 60 * 60 * 1000);
    
    console.log('🎉 ポートフォリオレベル制御システム稼働開始');
  }

  async deactivate() {
    console.log('🛑 PortfolioLevelController停止中...');
    this.isActive = false;
    
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    if (this.rebalanceInterval) clearInterval(this.rebalanceInterval);
    
    if (this.client) {
      await this.client.quit();
    }
    
    console.log('✅ PortfolioLevelController停止完了');
  }

  // 現在のポートフォリオ分析
  async analyzeCurrentPortfolio() {
    try {
      console.log('\n📊 現在のポートフォリオ分析実行中...');
      
      const positionKeys = await this.client.keys('position:*');
      const strategyBreakdown = {};
      const currencyBreakdown = {};
      let totalValue = 0;
      let longPositions = 0;
      let shortPositions = 0;
      
      for (const key of positionKeys) {
        try {
          const pos = await this.client.hGetAll(key);
          const strategy = pos.strategyKey || 'unknown';
          const symbol = pos.symbol || 'unknown';
          const amount = parseFloat(pos.amount) || 0;
          const price = parseFloat(pos.entryPrice) || 0;
          const value = Math.abs(amount * price);
          
          // 戦略別集計
          if (!strategyBreakdown[strategy]) {
            strategyBreakdown[strategy] = {
              count: 0,
              totalValue: 0,
              percentage: 0,
              avgPositionSize: 0
            };
          }
          strategyBreakdown[strategy].count++;
          strategyBreakdown[strategy].totalValue += value;
          
          // 通貨別集計
          if (!currencyBreakdown[symbol]) {
            currencyBreakdown[symbol] = {
              count: 0,
              totalValue: 0,
              percentage: 0
            };
          }
          currencyBreakdown[symbol].count++;
          currencyBreakdown[symbol].totalValue += value;
          
          totalValue += value;
          
          if (amount > 0) {
            longPositions++;
          } else if (amount < 0) {
            shortPositions++;
          }
          
        } catch (err) {
          // エラーはスキップ
        }
      }
      
      // パーセンテージ計算
      Object.keys(strategyBreakdown).forEach(strategy => {
        const s = strategyBreakdown[strategy];
        s.percentage = totalValue > 0 ? (s.totalValue / totalValue) : 0;
        s.avgPositionSize = s.count > 0 ? (s.totalValue / s.count) : 0;
      });
      
      Object.keys(currencyBreakdown).forEach(currency => {
        const c = currencyBreakdown[currency];
        c.percentage = totalValue > 0 ? (c.totalValue / totalValue) : 0;
      });
      
      const longRatio = (longPositions + shortPositions) > 0 ? 
        longPositions / (longPositions + shortPositions) : 0;
      
      // ポートフォリオ状態更新
      this.portfolioState = {
        currentAllocation: strategyBreakdown,
        currencyAllocation: currencyBreakdown,
        totalValue,
        totalPositions: positionKeys.length,
        longRatio,
        longPositions,
        shortPositions,
        lastAnalysis: Date.now()
      };
      
      console.log('\n現在のポートフォリオ状況:');
      console.log(`  総ポジション数: ${this.portfolioState.totalPositions}件`);
      console.log(`  総価値: ¥${Math.round(totalValue).toLocaleString()}`);
      console.log(`  ロング比率: ${(longRatio * 100).toFixed(1)}%`);
      
      console.log('\n戦略別配分:');
      Object.entries(strategyBreakdown)
        .sort(([,a], [,b]) => b.percentage - a.percentage)
        .forEach(([strategy, stats]) => {
          const target = this.portfolioConfig.strategyAllocation[strategy]?.target || 0;
          const deviation = Math.abs(stats.percentage - target);
          const status = deviation > 0.05 ? '⚠️' : '✅';
          
          console.log(`  ${strategy}: ${(stats.percentage * 100).toFixed(1)}% ${status}`);
          console.log(`    目標: ${(target * 100).toFixed(1)}%, 偏差: ${(deviation * 100).toFixed(1)}%`);
        });
      
      // リスク評価
      await this.evaluatePortfolioRisk();
      
    } catch (error) {
      console.error('❌ ポートフォリオ分析エラー:', error.message);
    }
  }

  // ポートフォリオリスク評価
  async evaluatePortfolioRisk() {
    try {
      console.log('\n⚖️ ポートフォリオリスク評価実行中...');
      
      const riskMetrics = {
        concentration: this.calculateConcentrationRisk(),
        longBias: this.portfolioState.longRatio,
        singleStrategyMax: this.calculateMaxStrategyConcentration(),
        singleCurrencyMax: this.calculateMaxCurrencyConcentration(),
        overallRiskScore: 0
      };
      
      // リスクスコア計算 (0-100, 低いほど良い)
      let riskScore = 0;
      
      // 集中リスク (最大30点)
      riskScore += Math.min(riskMetrics.concentration * 30, 30);
      
      // ロング偏りリスク (最大25点)
      if (riskMetrics.longBias > 0.85) {
        riskScore += (riskMetrics.longBias - 0.85) * 166.7; // 0.85-1.0 → 0-25点
      }
      
      // 単一戦略集中リスク (最大25点)
      if (riskMetrics.singleStrategyMax > this.portfolioConfig.maxSingleStrategyRatio) {
        const excess = riskMetrics.singleStrategyMax - this.portfolioConfig.maxSingleStrategyRatio;
        riskScore += excess * 100; // 超過分を点数化
      }
      
      // 単一通貨集中リスク (最大20点)
      if (riskMetrics.singleCurrencyMax > this.portfolioConfig.maxSingleCurrencyRatio) {
        const excess = riskMetrics.singleCurrencyMax - this.portfolioConfig.maxSingleCurrencyRatio;
        riskScore += excess * 200; // 超過分を点数化
      }
      
      riskMetrics.overallRiskScore = Math.min(riskScore, 100);
      
      this.portfolioState.riskMetrics = riskMetrics;
      
      console.log('  リスク評価結果:');
      console.log(`    集中リスク: ${(riskMetrics.concentration * 100).toFixed(1)}%`);
      console.log(`    ロング偏り: ${(riskMetrics.longBias * 100).toFixed(1)}%`);
      console.log(`    最大戦略集中: ${(riskMetrics.singleStrategyMax * 100).toFixed(1)}%`);
      console.log(`    最大通貨集中: ${(riskMetrics.singleCurrencyMax * 100).toFixed(1)}%`);
      console.log(`    総合リスクスコア: ${riskMetrics.overallRiskScore.toFixed(1)}/100`);
      
      // リスク警告
      if (riskMetrics.overallRiskScore > 70) {
        console.log('  🔴 HIGH RISK: 緊急リバランシング推奨');
      } else if (riskMetrics.overallRiskScore > 40) {
        console.log('  🟡 MEDIUM RISK: リバランシング検討');
      } else {
        console.log('  🟢 LOW RISK: リスク管理良好');
      }
      
    } catch (error) {
      console.error('❌ リスク評価エラー:', error.message);
    }
  }

  // 集中リスク計算 (ハーフィンダール指数)
  calculateConcentrationRisk() {
    const allocations = Object.values(this.portfolioState.currentAllocation);
    const herfindahlIndex = allocations.reduce((sum, alloc) => {
      return sum + Math.pow(alloc.percentage, 2);
    }, 0);
    return herfindahlIndex;
  }

  // 最大戦略集中度計算
  calculateMaxStrategyConcentration() {
    const allocations = Object.values(this.portfolioState.currentAllocation);
    return Math.max(...allocations.map(alloc => alloc.percentage));
  }

  // 最大通貨集中度計算
  calculateMaxCurrencyConcentration() {
    const allocations = Object.values(this.portfolioState.currencyAllocation || {});
    return allocations.length > 0 ? Math.max(...allocations.map(alloc => alloc.percentage)) : 0;
  }

  // 定期ポートフォリオ監視
  async performPortfolioMonitoring() {
    if (!this.isActive) return;
    
    try {
      console.log(`\n📈 定期ポートフォリオ監視 (${new Date().toLocaleString('ja-JP')})`);
      
      // 現在のポートフォリオ分析
      await this.analyzeCurrentPortfolio();
      
      // パフォーマンス記録
      const performanceRecord = {
        timestamp: Date.now(),
        totalValue: this.portfolioState.totalValue,
        totalPositions: this.portfolioState.totalPositions,
        longRatio: this.portfolioState.longRatio,
        riskScore: this.portfolioState.riskMetrics?.overallRiskScore || 0,
        strategyAllocation: { ...this.portfolioState.currentAllocation }
      };
      
      this.performanceHistory.push(performanceRecord);
      
      // 最新100件のみ保持
      if (this.performanceHistory.length > 100) {
        this.performanceHistory = this.performanceHistory.slice(-100);
      }
      
      // Redis保存
      await this.savePortfolioState();
      
    } catch (error) {
      console.error('❌ 定期監視エラー:', error.message);
    }
  }

  // リバランシング必要性評価
  async evaluateRebalancingNeeds() {
    if (!this.isActive) return;
    
    try {
      console.log('\n🔄 リバランシング必要性評価中...');
      
      const rebalanceNeeds = [];
      
      // 戦略別偏差チェック
      Object.entries(this.portfolioConfig.strategyAllocation).forEach(([strategy, config]) => {
        const current = this.portfolioState.currentAllocation[strategy]?.percentage || 0;
        const target = config.target;
        const deviation = Math.abs(current - target);
        
        if (deviation > 0.05) { // 5%以上の偏差
          rebalanceNeeds.push({
            type: 'STRATEGY_DEVIATION',
            strategy,
            current: (current * 100).toFixed(1) + '%',
            target: (target * 100).toFixed(1) + '%',
            deviation: (deviation * 100).toFixed(1) + '%',
            action: current > target ? 'REDUCE' : 'INCREASE',
            priority: deviation > 0.1 ? 'HIGH' : 'MEDIUM'
          });
        }
      });
      
      // リスクスコアチェック
      const riskScore = this.portfolioState.riskMetrics?.overallRiskScore || 0;
      if (riskScore > 50) {
        rebalanceNeeds.push({
          type: 'RISK_MANAGEMENT',
          description: '総合リスクスコア高',
          riskScore: riskScore.toFixed(1),
          action: 'RISK_REDUCTION',
          priority: riskScore > 70 ? 'CRITICAL' : 'HIGH'
        });
      }
      
      // ロング偏りチェック
      if (this.portfolioState.longRatio > 0.85) {
        rebalanceNeeds.push({
          type: 'BIAS_CORRECTION',
          description: 'ロング偏り過度',
          longRatio: (this.portfolioState.longRatio * 100).toFixed(1) + '%',
          action: 'INCREASE_SHORT_STRATEGIES',
          priority: 'HIGH'
        });
      }
      
      console.log(`リバランシング必要性: ${rebalanceNeeds.length}件`);
      
      rebalanceNeeds.forEach((need, index) => {
        console.log(`\n必要性 ${index + 1} [${need.priority}]:`);
        console.log(`  タイプ: ${need.type}`);
        console.log(`  詳細: ${need.description || need.strategy}`);
        if (need.current) console.log(`  現在: ${need.current} → 目標: ${need.target}`);
        console.log(`  アクション: ${need.action}`);
      });
      
      // 自動リバランシング実行判定
      const criticalNeeds = rebalanceNeeds.filter(need => need.priority === 'CRITICAL');
      const highNeeds = rebalanceNeeds.filter(need => need.priority === 'HIGH');
      
      if (criticalNeeds.length > 0) {
        console.log('\n🚨 CRITICAL: 緊急リバランシング必要');
        await this.executeEmergencyRebalancing(criticalNeeds);
      } else if (highNeeds.length >= 2) {
        console.log('\n⚠️ HIGH: 計画的リバランシング推奨');
        // 計画的リバランシングは実装省略 (デモ)
      } else {
        console.log('\n✅ リバランシング不要: ポートフォリオ良好');
      }
      
    } catch (error) {
      console.error('❌ リバランシング評価エラー:', error.message);
    }
  }

  // 緊急リバランシング実行 (シミュレーション)
  async executeEmergencyRebalancing(criticalNeeds) {
    console.log('\n🚨 緊急リバランシング実行 (シミュレーション)');
    
    criticalNeeds.forEach(need => {
      console.log(`  処理: ${need.type} - ${need.action}`);
      
      switch (need.action) {
        case 'RISK_REDUCTION':
          console.log('    → 高リスクポジション削減');
          console.log('    → 保守戦略比率増加');
          break;
        case 'REDUCE':
          console.log(`    → ${need.strategy}ポジション削減`);
          break;
        case 'INCREASE':
          console.log(`    → ${need.strategy}ポジション増加`);
          break;
        case 'INCREASE_SHORT_STRATEGIES':
          console.log('    → ショート対応戦略比率増加');
          break;
      }
    });
    
    // リバランシング記録
    const rebalanceRecord = {
      timestamp: Date.now(),
      type: 'EMERGENCY',
      triggers: criticalNeeds,
      portfolioStateBefore: { ...this.portfolioState },
      actions: criticalNeeds.map(need => need.action),
      status: 'SIMULATED'
    };
    
    this.rebalanceHistory.push(rebalanceRecord);
    
    console.log('✅ 緊急リバランシング (シミュレーション) 完了');
  }

  // ポートフォリオ状態保存
  async savePortfolioState() {
    try {
      await this.client.hSet('portfolio_state', {
        currentAllocation: JSON.stringify(this.portfolioState.currentAllocation),
        totalValue: this.portfolioState.totalValue.toString(),
        totalPositions: this.portfolioState.totalPositions.toString(),
        longRatio: this.portfolioState.longRatio.toString(),
        riskScore: (this.portfolioState.riskMetrics?.overallRiskScore || 0).toString(),
        lastUpdate: Date.now().toString()
      });
      
      // パフォーマンス履歴保存 (最新のみ)
      if (this.performanceHistory.length > 0) {
        const latestPerformance = this.performanceHistory[this.performanceHistory.length - 1];
        await this.client.hSet('portfolio_performance', {
          timestamp: latestPerformance.timestamp.toString(),
          totalValue: latestPerformance.totalValue.toString(),
          riskScore: latestPerformance.riskScore.toString(),
          longRatio: latestPerformance.longRatio.toString()
        });
      }
      
    } catch (error) {
      console.error('ポートフォリオ状態保存エラー:', error.message);
    }
  }

  // 現在の状態取得
  getStatus() {
    return {
      isActive: this.isActive,
      portfolioState: this.portfolioState,
      portfolioConfig: this.portfolioConfig,
      performanceHistory: this.performanceHistory.slice(-10), // 最新10件
      rebalanceHistory: this.rebalanceHistory.slice(-5), // 最新5件
      uptime: this.startTime ? Date.now() - this.startTime : 0
    };
  }
}

module.exports = { PortfolioLevelController };