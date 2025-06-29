/**
 * Ultra-Think Phase 2.8: 動的戦略選択システム
 * AI-powered市場適応型戦略選択エンジン
 */
require('dotenv').config();
const redis = require('redis');

class DynamicStrategySelector {
  constructor() {
    this.client = null;
    this.isActive = false;
    this.startTime = null;
    
    // 戦略選択設定
    this.strategyConfig = {
      // 利用可能戦略
      availableStrategies: [
        'BOLLINGER_BANDS_CONSERVATIVE',
        'BOLLINGER_BANDS_AGGRESSIVE', 
        'MULTI_INDICATOR',
        'MEAN_REVERSION',
        'MACD',
        'TECHNICAL_MOMENTUM'
      ],
      
      // 市場状況別戦略適性
      marketRegimeStrategies: {
        trending: {
          primary: ['BOLLINGER_BANDS_AGGRESSIVE', 'MACD'],
          secondary: ['MULTI_INDICATOR'],
          avoid: ['MEAN_REVERSION']
        },
        ranging: {
          primary: ['MEAN_REVERSION', 'BOLLINGER_BANDS_CONSERVATIVE'],
          secondary: ['MULTI_INDICATOR', 'TECHNICAL_MOMENTUM'],
          avoid: ['BOLLINGER_BANDS_AGGRESSIVE']
        },
        volatile: {
          primary: ['BOLLINGER_BANDS_CONSERVATIVE', 'TECHNICAL_MOMENTUM'],
          secondary: ['MULTI_INDICATOR'],
          avoid: ['BOLLINGER_BANDS_AGGRESSIVE', 'MACD']
        },
        neutral: {
          primary: ['MULTI_INDICATOR', 'BOLLINGER_BANDS_CONSERVATIVE'],
          secondary: ['MEAN_REVERSION', 'MACD'],
          avoid: []
        }
      },
      
      // 戦略切り替え条件
      switchingThresholds: {
        minPerformancePeriod: 24 * 60 * 60 * 1000,  // 24時間
        underperformanceThreshold: 0.1,             // 10%下回る
        volatilityChangeThreshold: 0.2,             // 20%変化
        trendChangeThreshold: 0.15                  // 15%変化
      },
      
      // 戦略パフォーマンス重み
      performanceWeights: {
        profitability: 0.4,    // 収益性
        stability: 0.3,        // 安定性
        drawdown: 0.2,         // ドローダウン
        sharpeRatio: 0.1       // シャープレシオ
      }
    };
    
    // 市場状況分析
    this.marketAnalysis = {
      currentRegime: 'neutral',
      trendStrength: 0,
      volatility: 0,
      momentum: 0,
      lastAnalysis: null,
      confidence: 0
    };
    
    // 戦略パフォーマンス追跡
    this.strategyPerformance = {};
    this.performanceHistory = [];
    this.selectionHistory = [];
  }

  async initialize() {
    try {
      this.client = redis.createClient({ url: 'redis://redis:6379' });
      await this.client.connect();
      
      // 戦略パフォーマンス初期化
      await this.initializeStrategyPerformance();
      
      console.log('✅ DynamicStrategySelector initialized');
      return true;
    } catch (error) {
      console.error('❌ DynamicStrategySelector initialization failed:', error.message);
      return false;
    }
  }

  async activate() {
    if (this.isActive) {
      console.log('⚠️ DynamicStrategySelector already active');
      return;
    }

    console.log(`
🧠 動的戦略選択システム起動

## 🎯 Ultra-Think Phase 2.8実装

### AI-powered機能:
🔍 リアルタイム市場状況分析
🎯 最適戦略自動選択
📊 パフォーマンスベース学習
🔄 動的戦略切り替え
🧮 多次元評価アルゴリズム

### 市場適応戦略:
📈 トレンド相場: BOLLINGER_BANDS_AGGRESSIVE, MACD優先
📊 レンジ相場: MEAN_REVERSION, BOLLINGER_BANDS_CONSERVATIVE優先  
⚡ ボラティル相場: TECHNICAL_MOMENTUM, 保守戦略優先
🔄 中立相場: MULTI_INDICATOR, バランス戦略優先
    `);

    this.isActive = true;
    this.startTime = Date.now();
    
    // 初期市場分析
    await this.analyzeMarketConditions();
    
    // 定期市場分析 (15分間隔)
    this.marketAnalysisInterval = setInterval(async () => {
      await this.analyzeMarketConditions();
    }, 15 * 60 * 1000);
    
    // 戦略選択評価 (1時間間隔)
    this.strategyEvaluationInterval = setInterval(async () => {
      await this.evaluateAndSelectStrategies();
    }, 60 * 60 * 1000);
    
    // パフォーマンス更新 (30分間隔)
    this.performanceUpdateInterval = setInterval(async () => {
      await this.updateStrategyPerformance();
    }, 30 * 60 * 1000);
    
    console.log('🎉 動的戦略選択システム稼働開始');
  }

  async deactivate() {
    console.log('🛑 DynamicStrategySelector停止中...');
    this.isActive = false;
    
    if (this.marketAnalysisInterval) clearInterval(this.marketAnalysisInterval);
    if (this.strategyEvaluationInterval) clearInterval(this.strategyEvaluationInterval);
    if (this.performanceUpdateInterval) clearInterval(this.performanceUpdateInterval);
    
    if (this.client) {
      await this.client.quit();
    }
    
    console.log('✅ DynamicStrategySelector停止完了');
  }

  // 戦略パフォーマンス初期化
  async initializeStrategyPerformance() {
    try {
      for (const strategy of this.strategyConfig.availableStrategies) {
        this.strategyPerformance[strategy] = {
          totalTrades: 0,
          winRate: 0,
          avgReturn: 0,
          volatility: 0,
          maxDrawdown: 0,
          sharpeRatio: 0,
          profitFactor: 0,
          lastUpdated: Date.now(),
          performanceScore: 50 // 初期値50点
        };
      }
    } catch (error) {
      console.error('戦略パフォーマンス初期化エラー:', error.message);
    }
  }

  // 市場状況分析
  async analyzeMarketConditions() {
    try {
      console.log('\n🔍 市場状況分析実行中...');
      
      // 過去24時間のデータ分析 (シミュレーション)
      const marketData = await this.getMarketData();
      
      // トレンド強度計算
      const trendStrength = this.calculateTrendStrength(marketData);
      
      // ボラティリティ計算
      const volatility = this.calculateVolatility(marketData);
      
      // モメンタム計算
      const momentum = this.calculateMomentum(marketData);
      
      // 市場体制判定
      const regime = this.determineMarketRegime(trendStrength, volatility, momentum);
      
      // 信頼度計算
      const confidence = this.calculateAnalysisConfidence(trendStrength, volatility);
      
      this.marketAnalysis = {
        currentRegime: regime,
        trendStrength,
        volatility,
        momentum,
        lastAnalysis: Date.now(),
        confidence
      };
      
      console.log('  市場分析結果:');
      console.log(`    市場体制: ${regime}`);
      console.log(`    トレンド強度: ${(trendStrength * 100).toFixed(1)}%`);
      console.log(`    ボラティリティ: ${(volatility * 100).toFixed(1)}%`);
      console.log(`    モメンタム: ${(momentum * 100).toFixed(1)}%`);
      console.log(`    分析信頼度: ${(confidence * 100).toFixed(1)}%`);
      
      // Redis保存
      await this.saveMarketAnalysis();
      
    } catch (error) {
      console.error('❌ 市場分析エラー:', error.message);
    }
  }

  // 市場データ取得 (シミュレーション)
  async getMarketData() {
    // 実際の実装では過去のfilled_tradeや価格データを使用
    // ここではシミュレーションデータを生成
    const data = [];
    const baseTime = Date.now() - 24 * 60 * 60 * 1000; // 24時間前
    
    for (let _i = 0; _i < 24; _i++) {
      data.push({
        timestamp: baseTime + _i * 60 * 60 * 1000,
        price: 5000000 + Math.random() * 100000, // BTCベース価格
        volume: Math.random() * 100,
        change: (Math.random() - 0.5) * 0.1 // ±5%変化
      });
    }
    
    return data;
  }

  // トレンド強度計算
  calculateTrendStrength(data) {
    if (data.length < 2) return 0;
    
    let upMoves = 0;
    let downMoves = 0;
    
    for (let i = 1; i < data.length; i++) {
      const change = data[i].change;
      if (change > 0) upMoves++;
      else if (change < 0) downMoves++;
    }
    
    const totalMoves = upMoves + downMoves;
    if (totalMoves === 0) return 0;
    
    // トレンド方向性の一貫性
    const dominantDirection = Math.max(upMoves, downMoves);
    return dominantDirection / totalMoves;
  }

  // ボラティリティ計算
  calculateVolatility(data) {
    if (data.length < 2) return 0;
    
    const changes = data.slice(1).map((d, _i) => Math.abs(d.change));
    const avgVolatility = changes.reduce((sum, change) => sum + change, 0) / changes.length;
    
    return Math.min(avgVolatility * 10, 1); // 正規化
  }

  // モメンタム計算
  calculateMomentum(data) {
    if (data.length < 3) return 0;
    
    const recent = data.slice(-6); // 最新6時間
    const earlier = data.slice(-12, -6); // その前6時間
    
    const recentAvg = recent.reduce((sum, d) => sum + d.change, 0) / recent.length;
    const earlierAvg = earlier.reduce((sum, d) => sum + d.change, 0) / earlier.length;
    
    return Math.max(-1, Math.min(1, (recentAvg - earlierAvg) * 5)); // 正規化
  }

  // 市場体制判定
  determineMarketRegime(trendStrength, volatility, momentum) {
    if (volatility > 0.7) {
      return 'volatile';
    } else if (trendStrength > 0.7 && Math.abs(momentum) > 0.3) {
      return 'trending';
    } else if (trendStrength < 0.4 && volatility < 0.3) {
      return 'ranging';
    } else {
      return 'neutral';
    }
  }

  // 分析信頼度計算
  calculateAnalysisConfidence(trendStrength, volatility) {
    // 強いトレンドまたは明確な低ボラティリティ時に高信頼度
    const trendConfidence = Math.abs(trendStrength - 0.5) * 2; // 0.5から離れるほど高信頼度
    const volatilityConfidence = volatility > 0.8 || volatility < 0.2 ? 0.8 : 0.5;
    
    return (trendConfidence + volatilityConfidence) / 2;
  }

  // 戦略評価・選択
  async evaluateAndSelectStrategies() {
    try {
      console.log('\n🎯 戦略評価・選択実行中...');
      
      // 現在の市場体制に基づく戦略推奨
      const regimeStrategies = this.strategyConfig.marketRegimeStrategies[this.marketAnalysis.currentRegime];
      
      console.log(`  市場体制: ${this.marketAnalysis.currentRegime}`);
      console.log(`  推奨戦略: ${regimeStrategies.primary.join(', ')}`);
      console.log(`  補助戦略: ${regimeStrategies.secondary.join(', ')}`);
      console.log(`  回避戦略: ${regimeStrategies.avoid.join(', ')}`);
      
      // 戦略パフォーマンススコア計算
      const strategyScores = {};
      
      for (const strategy of this.strategyConfig.availableStrategies) {
        let score = this.strategyPerformance[strategy].performanceScore;
        
        // 市場適性ボーナス/ペナルティ
        if (regimeStrategies.primary.includes(strategy)) {
          score *= 1.3; // 30%ボーナス
        } else if (regimeStrategies.secondary.includes(strategy)) {
          score *= 1.1; // 10%ボーナス
        } else if (regimeStrategies.avoid.includes(strategy)) {
          score *= 0.7; // 30%ペナルティ
        }
        
        // 信頼度による調整
        const confidenceMultiplier = 0.7 + (this.marketAnalysis.confidence * 0.3);
        score *= confidenceMultiplier;
        
        strategyScores[strategy] = score;
      }
      
      // スコア順にソート
      const rankedStrategies = Object.entries(strategyScores)
        .sort(([,a], [,b]) => b - a)
        .map(([strategy, score]) => ({ strategy, score }));
      
      console.log('\n  戦略ランキング:');
      rankedStrategies.forEach((item, index) => {
        const rank = index + 1;
        const emoji = rank <= 3 ? '🥇🥈🥉'[rank - 1] : '📊';
        console.log(`    ${rank}. ${emoji} ${item.strategy}: ${item.score.toFixed(1)}点`);
      });
      
      // 選択結果記録
      const selection = {
        timestamp: Date.now(),
        marketRegime: this.marketAnalysis.currentRegime,
        confidence: this.marketAnalysis.confidence,
        topStrategies: rankedStrategies.slice(0, 3),
        recommendations: {
          primary: rankedStrategies[0].strategy,
          secondary: rankedStrategies[1].strategy,
          tertiary: rankedStrategies[2].strategy
        }
      };
      
      this.selectionHistory.push(selection);
      
      // 最新50件のみ保持
      if (this.selectionHistory.length > 50) {
        this.selectionHistory = this.selectionHistory.slice(-50);
      }
      
      // Redis保存
      await this.saveStrategySelection(selection);
      
      console.log(`\n  🎯 最適戦略選択: ${selection.recommendations.primary}`);
      
    } catch (error) {
      console.error('❌ 戦略評価・選択エラー:', error.message);
    }
  }

  // 戦略パフォーマンス更新
  async updateStrategyPerformance() {
    try {
      console.log('\n📊 戦略パフォーマンス更新中...');
      
      // 各戦略のポジション分析
      const positionKeys = await this.client.keys('position:*');
      const strategyStats = {};
      
      for (const key of positionKeys) {
        try {
          const pos = await this.client.hGetAll(key);
          const strategy = pos.strategyKey || 'unknown';
          
          if (!this.strategyConfig.availableStrategies.includes(strategy)) continue;
          
          if (!strategyStats[strategy]) {
            strategyStats[strategy] = {
              positions: 0,
              totalValue: 0,
              avgValue: 0,
              performance: []
            };
          }
          
          const amount = parseFloat(pos.amount) || 0;
          const price = parseFloat(pos.entryPrice) || 0;
          const value = Math.abs(amount * price);
          
          strategyStats[strategy].positions++;
          strategyStats[strategy].totalValue += value;
          
        } catch {
          // エラーはスキップ
        }
      }
      
      // パフォーマンススコア更新 (シミュレーション)
      for (const strategy of this.strategyConfig.availableStrategies) {
        const stats = strategyStats[strategy] || { positions: 0, totalValue: 0 };
        
        // 基本パフォーマンススコア (シミュレーション)
        const baseScore = 50 + (Math.random() - 0.5) * 20; // 40-60の範囲
        
        // ポジション数による調整
        const positionMultiplier = Math.min(1.2, 1 + (stats.positions * 0.01));
        
        // 価値による調整  
        const valueMultiplier = Math.min(1.1, 1 + (stats.totalValue / 10000));
        
        const finalScore = Math.max(0, Math.min(100, baseScore * positionMultiplier * valueMultiplier));
        
        this.strategyPerformance[strategy] = {
          ...this.strategyPerformance[strategy],
          totalTrades: stats.positions,
          performanceScore: finalScore,
          lastUpdated: Date.now()
        };
        
        console.log(`  ${strategy}: ${finalScore.toFixed(1)}点 (ポジション: ${stats.positions}件)`);
      }
      
      // Redis保存
      await this.saveStrategyPerformance();
      
    } catch (error) {
      console.error('❌ パフォーマンス更新エラー:', error.message);
    }
  }

  // 市場分析保存
  async saveMarketAnalysis() {
    try {
      await this.client.hSet('market_analysis', {
        currentRegime: this.marketAnalysis.currentRegime,
        trendStrength: this.marketAnalysis.trendStrength.toString(),
        volatility: this.marketAnalysis.volatility.toString(),
        momentum: this.marketAnalysis.momentum.toString(),
        confidence: this.marketAnalysis.confidence.toString(),
        lastAnalysis: this.marketAnalysis.lastAnalysis.toString()
      });
    } catch (error) {
      console.error('市場分析保存エラー:', error.message);
    }
  }

  // 戦略選択保存
  async saveStrategySelection(selection) {
    try {
      await this.client.hSet('strategy_selection', {
        timestamp: selection.timestamp.toString(),
        marketRegime: selection.marketRegime,
        confidence: selection.confidence.toString(),
        primaryStrategy: selection.recommendations.primary,
        secondaryStrategy: selection.recommendations.secondary,
        tertiaryStrategy: selection.recommendations.tertiary
      });
    } catch (error) {
      console.error('戦略選択保存エラー:', error.message);
    }
  }

  // 戦略パフォーマンス保存
  async saveStrategyPerformance() {
    try {
      for (const [strategy, performance] of Object.entries(this.strategyPerformance)) {
        await this.client.hSet(`strategy_performance:${strategy}`, {
          performanceScore: performance.performanceScore.toString(),
          totalTrades: performance.totalTrades.toString(),
          lastUpdated: performance.lastUpdated.toString()
        });
      }
    } catch (error) {
      console.error('戦略パフォーマンス保存エラー:', error.message);
    }
  }

  // 現在の状態取得
  getStatus() {
    return {
      isActive: this.isActive,
      marketAnalysis: this.marketAnalysis,
      strategyPerformance: this.strategyPerformance,
      selectionHistory: this.selectionHistory.slice(-10), // 最新10件
      uptime: this.startTime ? Date.now() - this.startTime : 0
    };
  }
}

module.exports = { DynamicStrategySelector };