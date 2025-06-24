/**
 * 基本異常検知システム
 * リアルタイム監視と自動修復機能
 */
require('dotenv').config();
const redis = require('redis');

class BasicAnomalyDetector {
  constructor() {
    this.client = null;
    this.isRunning = false;
    this.intervals = [];
    
    // 閾値設定
    this.thresholds = {
      positionSummaryInconsistency: 0.05,  // 5%以上の不整合
      positionBiasExtreme: 0.85,           // 85%以上のロング偏り
      orderFailureRate: 0.20,              // 20%以上の注文失敗
      dataCompletenessMinimum: {
        filled_trade: 0,
        trade_summary: 10,
        position: 5
      }
    };
    
    // アラート履歴
    this.alertHistory = [];
    this.lastChecks = {};
  }

  async initialize() {
    try {
      this.client = redis.createClient({ url: 'redis://redis:6379' });
      await this.client.connect();
      console.log('✅ BasicAnomalyDetector initialized');
      return true;
    } catch (error) {
      console.error('❌ BasicAnomalyDetector initialization failed:', error.message);
      return false;
    }
  }

  async start() {
    if (this.isRunning) {
      console.log('⚠️ BasicAnomalyDetector already running');
      return;
    }

    console.log(`
🚀 基本異常検知システム開始

監視項目:
• Position-Summary整合性 (5分間隔)
• ポジション偏り (10分間隔)  
• 注文実行失敗率 (15分間隔)
• データ完全性 (30分間隔)
• 予測的リスク分析 (60分間隔)
    `);

    this.isRunning = true;

    // 1. Position-Summary整合性監視 (5分間隔)
    this.intervals.push(setInterval(async () => {
      await this.checkPositionSummaryConsistency();
    }, 5 * 60 * 1000));

    // 2. ポジション偏り監視 (10分間隔)
    this.intervals.push(setInterval(async () => {
      await this.checkPositionBias();
    }, 10 * 60 * 1000));

    // 3. 注文実行失敗率監視 (15分間隔)
    this.intervals.push(setInterval(async () => {
      await this.checkOrderExecutionHealth();
    }, 15 * 60 * 1000));

    // 4. データ完全性監視 (30分間隔)
    this.intervals.push(setInterval(async () => {
      await this.checkDataCompleteness();
    }, 30 * 60 * 1000));

    // 5. 予測的リスク分析 (60分間隔)
    this.intervals.push(setInterval(async () => {
      await this.predictiveRiskAnalysis();
    }, 60 * 60 * 1000));

    // 初回実行
    setTimeout(async () => {
      console.log('🔍 初回異常検知チェック実行中...');
      await this.checkPositionSummaryConsistency();
      await this.checkPositionBias();
      await this.checkDataCompleteness();
    }, 5000);
  }

  async stop() {
    console.log('🛑 BasicAnomalyDetector停止中...');
    this.isRunning = false;
    
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    
    if (this.client) {
      await this.client.quit();
    }
    console.log('✅ BasicAnomalyDetector停止完了');
  }

  // Position-Summary整合性チェック
  async checkPositionSummaryConsistency() {
    try {
      console.log('🔍 Position-Summary整合性チェック実行中...');
      
      const positionKeys = await this.client.keys('position:*');
      const summaryKeys = await this.client.keys('trade_summary:*');
      
      let missingCount = 0;
      const missingCombinations = [];
      
      for (const posKey of positionKeys.slice(0, 100)) { // サンプリング
        try {
          const position = await this.client.hGetAll(posKey);
          if (!position.symbol || !position.strategyKey) continue;
          
          const expectedSummaryKey = `trade_summary:${position.symbol}:${position.strategyKey}`;
          const summaryExists = await this.client.exists(expectedSummaryKey);
          
          if (!summaryExists) {
            missingCount++;
            missingCombinations.push({
              symbol: position.symbol,
              strategy: position.strategyKey,
              positionKey: posKey
            });
          }
        } catch (err) {
          // エラーはスキップ
        }
      }
      
      const checkedPositions = Math.min(positionKeys.length, 100);
      const inconsistencyRate = checkedPositions > 0 ? missingCount / checkedPositions : 0;
      
      console.log(`  チェック済みポジション: ${checkedPositions}件`);
      console.log(`  不整合数: ${missingCount}件`);
      console.log(`  不整合率: ${(inconsistencyRate * 100).toFixed(2)}%`);
      
      // 記録保存
      this.lastChecks.positionSummaryConsistency = {
        timestamp: Date.now(),
        inconsistencyRate,
        missingCount,
        checkedPositions
      };
      
      // 閾値チェック
      if (inconsistencyRate > this.thresholds.positionSummaryInconsistency) {
        await this.triggerAlert('CRITICAL', 'Position-Summary Inconsistency', {
          inconsistencyRate: (inconsistencyRate * 100).toFixed(2) + '%',
          missingCount,
          threshold: (this.thresholds.positionSummaryInconsistency * 100) + '%',
          missingCombinations: missingCombinations.slice(0, 5) // 最初の5件
        });
        
        // 自動修復試行
        if (missingCount > 0 && missingCount < 20) { // 適度な数なら自動修復
          await this.autoRepairTradeSummary(missingCombinations.slice(0, 10));
        }
      } else {
        console.log('✅ Position-Summary整合性: 正常');
      }
      
    } catch (error) {
      console.error('❌ Position-Summary整合性チェックエラー:', error.message);
    }
  }

  // ポジション偏りチェック
  async checkPositionBias() {
    try {
      console.log('🔍 ポジション偏りチェック実行中...');
      
      const positionKeys = await this.client.keys('position:*');
      let longCount = 0;
      let shortCount = 0;
      let totalValue = 0;
      
      for (const key of positionKeys) {
        try {
          const position = await this.client.hGetAll(key);
          const amount = parseFloat(position.amount) || 0;
          const price = parseFloat(position.entryPrice) || 0;
          
          if (amount > 0) {
            longCount++;
            totalValue += amount * price;
          } else if (amount < 0) {
            shortCount++;
          }
        } catch (err) {
          // エラーはスキップ
        }
      }
      
      const totalPositions = longCount + shortCount;
      const longRatio = totalPositions > 0 ? longCount / totalPositions : 0;
      
      console.log(`  ロングポジション: ${longCount}件`);
      console.log(`  ショートポジション: ${shortCount}件`);
      console.log(`  ロング比率: ${(longRatio * 100).toFixed(1)}%`);
      console.log(`  総ポジション価値: ¥${totalValue.toLocaleString()}`);
      
      // 記録保存
      this.lastChecks.positionBias = {
        timestamp: Date.now(),
        longRatio,
        longCount,
        shortCount,
        totalValue
      };
      
      // 閾値チェック
      if (longRatio > this.thresholds.positionBiasExtreme) {
        await this.triggerAlert('HIGH', 'Extreme Position Bias', {
          longRatio: (longRatio * 100).toFixed(1) + '%',
          longCount,
          shortCount,
          threshold: (this.thresholds.positionBiasExtreme * 100) + '%',
          recommendation: '売り注文の実行確認、新規買い注文の制限検討'
        });
        
        // 自動制限機能（将来実装）
        // await this.enableBuyRestriction();
      } else {
        console.log('✅ ポジション偏り: 許容範囲内');
      }
      
    } catch (error) {
      console.error('❌ ポジション偏りチェックエラー:', error.message);
    }
  }

  // 注文実行ヘルスチェック
  async checkOrderExecutionHealth() {
    try {
      console.log('🔍 注文実行ヘルスチェック実行中...');
      
      // 直近15分の注文状況を確認
      const since = Date.now() - 15 * 60 * 1000;
      const pendingOrderKeys = await this.client.keys('pending_order:*');
      const filledTradeKeys = await this.client.keys('filled_trade:*');
      
      let recentOrders = 0;
      let recentFills = 0;
      
      // 未約定注文の古さを確認
      let expiredOrders = 0;
      for (const key of pendingOrderKeys.slice(0, 50)) {
        try {
          const order = await this.client.hGetAll(key);
          const orderTime = parseInt(order.timestamp) || parseInt(order.createdAt) || 0;
          
          if (orderTime > since) {
            recentOrders++;
          }
          
          // 1時間以上古い注文
          if (orderTime < Date.now() - 60 * 60 * 1000) {
            expiredOrders++;
          }
        } catch (err) {
          // エラーはスキップ  
        }
      }
      
      // 直近の約定を確認
      for (const key of filledTradeKeys.slice(0, 50)) {
        try {
          const trade = await this.client.hGetAll(key);
          const tradeTime = parseInt(trade.timestamp) || parseInt(trade.createdAt) || 0;
          
          if (tradeTime > since) {
            recentFills++;
          }
        } catch (err) {
          // エラーはスキップ
        }
      }
      
      const successRate = recentOrders > 0 ? recentFills / recentOrders : 1;
      const failureRate = 1 - successRate;
      
      console.log(`  直近15分の注文: ${recentOrders}件`);
      console.log(`  直近15分の約定: ${recentFills}件`);
      console.log(`  推定成功率: ${(successRate * 100).toFixed(1)}%`);
      console.log(`  期限切れ注文: ${expiredOrders}件`);
      
      // 記録保存
      this.lastChecks.orderExecutionHealth = {
        timestamp: Date.now(),
        recentOrders,
        recentFills,
        successRate,
        failureRate,
        expiredOrders
      };
      
      // 閾値チェック
      if (failureRate > this.thresholds.orderFailureRate || expiredOrders > 10) {
        await this.triggerAlert('HIGH', 'Order Execution Degradation', {
          failureRate: (failureRate * 100).toFixed(1) + '%',
          expiredOrders,
          recentOrders,
          recentFills,
          recommendation: '注文実行エンジンの確認、API接続状況の診断'
        });
      } else {
        console.log('✅ 注文実行ヘルス: 正常');
      }
      
    } catch (error) {
      console.error('❌ 注文実行ヘルスチェックエラー:', error.message);
    }
  }

  // データ完全性チェック
  async checkDataCompleteness() {
    try {
      console.log('🔍 データ完全性チェック実行中...');
      
      const dataChecks = [
        { name: 'filled_trade', pattern: 'filled_trade:*' },
        { name: 'trade_summary', pattern: 'trade_summary:*' },
        { name: 'position', pattern: 'position:*' },
        { name: 'pending_order', pattern: 'pending_order:*' }
      ];
      
      const results = {};
      
      for (const check of dataChecks) {
        const keys = await this.client.keys(check.pattern);
        results[check.name] = keys.length;
        
        console.log(`  ${check.name}: ${keys.length}件`);
        
        // 閾値チェック
        const threshold = this.thresholds.dataCompletenessMinimum[check.name] || 0;
        if (keys.length <= threshold) {
          await this.triggerAlert('CRITICAL', `${check.name} Data Missing`, {
            count: keys.length,
            threshold,
            severity: keys.length === 0 ? 'COMPLETE_LOSS' : 'BELOW_MINIMUM'
          });
        }
      }
      
      // 記録保存
      this.lastChecks.dataCompleteness = {
        timestamp: Date.now(),
        ...results
      };
      
      console.log('✅ データ完全性チェック完了');
      
    } catch (error) {
      console.error('❌ データ完全性チェックエラー:', error.message);
    }
  }

  // 予測的リスク分析
  async predictiveRiskAnalysis() {
    try {
      console.log('🔮 予測的リスク分析実行中...');
      
      // 過去24時間の傾向分析
      const riskTrends = {
        positionBiasRisk: 0,
        dataIntegrityRisk: 0,
        systemPerformanceRisk: 0
      };
      
      // ポジション偏りのトレンド
      if (this.lastChecks.positionBias) {
        const currentLongRatio = this.lastChecks.positionBias.longRatio || 0;
        riskTrends.positionBiasRisk = Math.min(currentLongRatio / this.thresholds.positionBiasExtreme, 1);
      }
      
      // データ整合性のトレンド
      if (this.lastChecks.positionSummaryConsistency) {
        const currentInconsistency = this.lastChecks.positionSummaryConsistency.inconsistencyRate || 0;
        riskTrends.dataIntegrityRisk = Math.min(currentInconsistency / this.thresholds.positionSummaryInconsistency, 1);
      }
      
      // システムパフォーマンスのトレンド
      if (this.lastChecks.orderExecutionHealth) {
        const currentFailureRate = this.lastChecks.orderExecutionHealth.failureRate || 0;
        riskTrends.systemPerformanceRisk = Math.min(currentFailureRate / this.thresholds.orderFailureRate, 1);
      }
      
      const overallRiskScore = (
        riskTrends.positionBiasRisk * 0.4 +
        riskTrends.dataIntegrityRisk * 0.4 +
        riskTrends.systemPerformanceRisk * 0.2
      );
      
      console.log(`  ポジション偏りリスク: ${(riskTrends.positionBiasRisk * 100).toFixed(1)}%`);
      console.log(`  データ整合性リスク: ${(riskTrends.dataIntegrityRisk * 100).toFixed(1)}%`);
      console.log(`  システム性能リスク: ${(riskTrends.systemPerformanceRisk * 100).toFixed(1)}%`);
      console.log(`  総合リスクスコア: ${(overallRiskScore * 100).toFixed(1)}%`);
      
      // 高リスク時の予防的アラート
      if (overallRiskScore > 0.7) {
        await this.triggerAlert('PREDICTED_RISK', 'High Risk Trend Detected', {
          overallRiskScore: (overallRiskScore * 100).toFixed(1) + '%',
          riskTrends,
          recommendation: '予防的対策の実行を推奨'
        });
      }
      
      // 記録保存
      this.lastChecks.predictiveRisk = {
        timestamp: Date.now(),
        overallRiskScore,
        riskTrends
      };
      
    } catch (error) {
      console.error('❌ 予測的リスク分析エラー:', error.message);
    }
  }

  // アラート送信
  async triggerAlert(severity, title, details) {
    const alert = {
      timestamp: Date.now(),
      severity,
      title,
      details,
      dateTime: new Date().toLocaleString('ja-JP')
    };
    
    this.alertHistory.push(alert);
    
    // 最新100件のみ保持
    if (this.alertHistory.length > 100) {
      this.alertHistory = this.alertHistory.slice(-100);
    }
    
    console.log(`\n🚨 ALERT [${severity}]: ${title}`);
    console.log(`   時刻: ${alert.dateTime}`);
    console.log(`   詳細: ${JSON.stringify(details, null, 2)}`);
    
    // Redis にアラート記録
    try {
      const alertKey = `anomaly_alert:${Date.now()}`;
      await this.client.hSet(alertKey, {
        severity,
        title,
        details: JSON.stringify(details),
        timestamp: alert.timestamp.toString()
      });
      
      // 24時間で期限切れ
      await this.client.expire(alertKey, 24 * 60 * 60);
    } catch (error) {
      console.error('アラート記録エラー:', error.message);
    }
  }

  // 自動修復: Trade Summary
  async autoRepairTradeSummary(missingCombinations) {
    console.log(`🔧 Trade Summary自動修復開始: ${missingCombinations.length}件`);
    
    let repairedCount = 0;
    
    for (const combo of missingCombinations) {
      try {
        // そのシンボル・戦略のポジションを集計
        const positions = await this.client.keys(`position:*`);
        let buyAmount = 0;
        let sellAmount = 0;
        let netPosition = 0;
        
        for (const posKey of positions) {
          const pos = await this.client.hGetAll(posKey);
          if (pos.symbol === combo.symbol && pos.strategyKey === combo.strategy) {
            const amount = parseFloat(pos.amount) || 0;
            if (amount > 0) {
              buyAmount += amount;
            } else {
              sellAmount += Math.abs(amount);
            }
            netPosition += amount;
          }
        }
        
        if (buyAmount > 0 || sellAmount > 0 || netPosition !== 0) {
          const summaryKey = `trade_summary:${combo.symbol}:${combo.strategy}`;
          await this.client.hSet(summaryKey, {
            buyAmount: buyAmount.toFixed(8),
            sellAmount: sellAmount.toFixed(8),
            netPosition: netPosition.toFixed(8),
            lastUpdated: Date.now().toString(),
            autoRepaired: 'true'
          });
          
          repairedCount++;
          console.log(`  ✅ ${combo.symbol}:${combo.strategy} 修復完了`);
        }
        
      } catch (error) {
        console.log(`  ❌ ${combo.symbol}:${combo.strategy} 修復失敗: ${error.message}`);
      }
    }
    
    console.log(`🎉 Trade Summary自動修復完了: ${repairedCount}/${missingCombinations.length}件成功`);
    return repairedCount;
  }

  // 現在の状態取得
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastChecks: this.lastChecks,
      alertHistory: this.alertHistory.slice(-10), // 最新10件
      thresholds: this.thresholds
    };
  }
}

module.exports = { BasicAnomalyDetector };