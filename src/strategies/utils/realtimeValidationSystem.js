/**
 * Real-time Validation System
 * 
 * 金融システムにおけるリアルタイム検証とオーバーフィッティング防止
 * 
 * 主要機能：
 * - パフォーマンス劣化リアルタイム検出
 * - オーバーフィッティング警告システム
 * - 適応的パラメータ調整機能
 * - ライブトレーディングシステムとの統合
 * 
 * 作成者: worker-claude
 * 日付: 2025-06-28
 */

const { WalkForwardAnalysis, RegimeChangeDetector, ParameterDriftDetector } = require('./walkForwardAnalysis');
const { MonteCarloBootstrapping } = require('./monteCarloBootstrapping');
const EventEmitter = require('events');

/**
 * リアルタイム検証システム メインクラス
 */
class RealtimeValidationSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      validationWindow: config.validationWindow || 100, // 検証ウィンドウサイズ
      alertThreshold: config.alertThreshold || 0.2, // アラート閾値
      degradationThreshold: config.degradationThreshold || 0.15, // 劣化検出閾値
      rebalanceThreshold: config.rebalanceThreshold || 0.25, // リバランス閾値
      monitoringInterval: config.monitoringInterval || 30000, // 監視間隔(ms)
      enableAdaptiveAdjustment: config.enableAdaptiveAdjustment !== false,
      enableOverfittingDetection: config.enableOverfittingDetection !== false,
      enableRegimeDetection: config.enableRegimeDetection !== false,
      maxParameterDrift: config.maxParameterDrift || 0.3,
      confidenceLevel: config.confidenceLevel || 0.95,
      ...config
    };
    
    this.monitoringData = {
      historicalPerformance: [],
      recentReturns: [],
      currentParameters: {},
      performanceBaseline: null,
      lastValidation: null,
      alerts: [],
      regime: 'normal'
    };
    
    this.validationComponents = {
      walkForward: new WalkForwardAnalysis({
        trainWindow: Math.min(50, this.config.validationWindow),
        testWindow: Math.min(10, Math.floor(this.config.validationWindow * 0.2)),
        stepSize: 5,
        minTrainPeriods: Math.min(25, Math.floor(this.config.validationWindow * 0.3))
      }),
      regimeDetector: new RegimeChangeDetector({
        minRegimePeriod: 20,
        detectionMethod: 'markov_switching'
      }),
      parameterDriftDetector: new ParameterDriftDetector({
        significanceLevel: 0.05,
        windowSize: 30
      }),
      monteCarloBootstrap: new MonteCarloBootstrapping({
        iterations: 1000, // リアルタイム用に軽量化
        confidenceLevel: this.config.confidenceLevel,
        method: 'traditional'
      })
    };
    
    this.isMonitoring = false;
    this.monitoringTimer = null;
  }
  
  /**
   * リアルタイム監視を開始
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.warn('リアルタイム監視は既に開始されています');
      return;
    }
    
    console.log('🔄 リアルタイム検証システムを開始します...');
    this.isMonitoring = true;
    
    this.monitoringTimer = setInterval(() => {
      this.performValidation();
    }, this.config.monitoringInterval);
    
    this.emit('monitoring_started', {
      timestamp: new Date().toISOString(),
      config: this.config
    });
  }
  
  /**
   * リアルタイム監視を停止
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }
    
    console.log('⏹️ リアルタイム検証システムを停止します...');
    this.isMonitoring = false;
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    this.emit('monitoring_stopped', {
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * 新しいトレード結果を追加
   * @param {Object} tradeResult - トレード結果
   */
  addTradeResult(tradeResult) {
    const {
      timestamp = new Date(),
      returnValue,
      profit,
      parameters = {},
      strategyName,
      symbol
    } = tradeResult;
    
    // 履歴データに追加
    this.monitoringData.historicalPerformance.push({
      timestamp,
      returnValue: returnValue || (profit || 0) / 10000,
      profit: profit || 0,
      parameters,
      strategyName,
      symbol
    });
    
    // リアルタイムリターンに追加
    this.monitoringData.recentReturns.push(returnValue || (profit || 0) / 10000);
    
    // ウィンドウサイズの制限
    if (this.monitoringData.historicalPerformance.length > this.config.validationWindow * 2) {
      this.monitoringData.historicalPerformance = this.monitoringData.historicalPerformance.slice(-this.config.validationWindow * 2);
    }
    
    if (this.monitoringData.recentReturns.length > this.config.validationWindow) {
      this.monitoringData.recentReturns = this.monitoringData.recentReturns.slice(-this.config.validationWindow);
    }
    
    // パラメータ更新
    this.monitoringData.currentParameters = { ...parameters };
    
    this.emit('trade_result_added', {
      timestamp: timestamp.toISOString(),
      tradeResult,
      totalTrades: this.monitoringData.historicalPerformance.length
    });
  }
  
  /**
   * パフォーマンスベースラインを設定
   * @param {Object} baseline - ベースライン情報
   */
  setPerformanceBaseline(baseline) {
    this.monitoringData.performanceBaseline = {
      ...baseline,
      timestamp: new Date().toISOString()
    };
    
    console.log('📊 パフォーマンスベースラインを設定しました');
    this.emit('baseline_updated', baseline);
  }
  
  /**
   * リアルタイム検証を実行
   */
  async performValidation() {
    try {
      if (this.monitoringData.recentReturns.length < 20) {
        // データ不足時は検証をスキップ
        return;
      }
      
      const validationResults = {
        timestamp: new Date().toISOString(),
        performanceDegradation: await this.detectPerformanceDegradation(),
        overfittingRisk: await this.detectOverfittingRisk(),
        regimeChange: await this.detectRegimeChange(),
        parameterDrift: await this.detectParameterDrift(),
        alerts: [],
        recommendations: []
      };
      
      // アラートとレコメンデーションの生成
      await this.generateAlertsAndRecommendations(validationResults);
      
      // 検証結果を保存
      this.monitoringData.lastValidation = validationResults;
      
      this.emit('validation_completed', validationResults);
      
    } catch (error) {
      console.error('❌ リアルタイム検証エラー:', error.message);
      this.emit('validation_error', error);
    }
  }
  
  /**
   * パフォーマンス劣化を検出
   * @returns {Object} 劣化検出結果
   */
  async detectPerformanceDegradation() {
    if (!this.monitoringData.performanceBaseline) {
      return { detected: false, reason: 'no_baseline' };
    }
    
    const recentReturns = this.monitoringData.recentReturns.slice(-30); // 直近30取引
    if (recentReturns.length < 10) {
      return { detected: false, reason: 'insufficient_data' };
    }
    
    const recentPerformance = this.calculatePerformanceMetrics(recentReturns);
    const baseline = this.monitoringData.performanceBaseline;
    
    // Sharpe比率の比較
    const sharpeDegradation = baseline.sharpeRatio > 0 ? 
      (baseline.sharpeRatio - recentPerformance.sharpeRatio) / baseline.sharpeRatio : 0;
    
    // リターンの比較
    const returnDegradation = baseline.meanReturn > 0 ?
      (baseline.meanReturn - recentPerformance.meanReturn) / baseline.meanReturn : 0;
    
    // 最大ドローダウンの比較
    const drawdownDegradation = recentPerformance.maxDrawdown > baseline.maxDrawdown ?
      (recentPerformance.maxDrawdown - baseline.maxDrawdown) / (baseline.maxDrawdown + 0.01) : 0;
    
    const degradationScore = Math.max(sharpeDegradation, returnDegradation, drawdownDegradation);
    const detected = degradationScore > this.config.degradationThreshold;
    
    return {
      detected,
      degradationScore,
      sharpeDegradation,
      returnDegradation,
      drawdownDegradation,
      recentPerformance,
      baseline
    };
  }
  
  /**
   * オーバーフィッティングリスクを検出
   * @returns {Object} オーバーフィッティング検出結果
   */
  async detectOverfittingRisk() {
    if (!this.config.enableOverfittingDetection) {
      return { detected: false, reason: 'disabled' };
    }
    
    const returns = this.monitoringData.recentReturns;
    if (returns.length < 50) {
      return { detected: false, reason: 'insufficient_data' };
    }
    
    try {
      // Monte Carlo Bootstrap分析
      const mcResults = await this.validationComponents.monteCarloBootstrap.calculateSharpeConfidenceInterval(returns);
      
      // パラメータ安定性チェック
      const parameterHistory = this.monitoringData.historicalPerformance
        .slice(-50)
        .map(p => p.parameters)
        .filter(p => Object.keys(p).length > 0);
        
      const parameterStability = this.analyzeParameterStability(parameterHistory);
      
      // 信頼区間の幅でオーバーフィッティングを判定
      const ciWidth = mcResults.confidenceInterval.upper - mcResults.confidenceInterval.lower;
      const isWideCI = ciWidth > 2.0; // 閾値は調整可能
      
      const overfittingScore = (isWideCI ? 0.5 : 0) + parameterStability * 0.5;
      const detected = overfittingScore > 0.6;
      
      return {
        detected,
        overfittingScore,
        mcResults,
        parameterStability,
        confidenceIntervalWidth: ciWidth
      };
      
    } catch (error) {
      return { 
        detected: false, 
        error: error.message 
      };
    }
  }
  
  /**
   * レジーム変化を検出
   * @returns {Object} レジーム変化検出結果
   */
  async detectRegimeChange() {
    if (!this.config.enableRegimeDetection) {
      return { detected: false, reason: 'disabled' };
    }
    
    const data = this.monitoringData.historicalPerformance.slice(-100);
    if (data.length < 50) {
      return { detected: false, reason: 'insufficient_data' };
    }
    
    try {
      const timeSeriesData = data.map(d => ({
        timestamp: d.timestamp,
        value: d.returnValue || 0
      }));
      
      const regimeAnalysis = this.validationComponents.regimeDetector.detectRegimeChange(timeSeriesData);
      
      // レジーム変化が検出された場合
      if (regimeAnalysis.hasRegimeChange) {
        this.monitoringData.regime = 'changed';
        
        return {
          detected: true,
          changePoint: regimeAnalysis.changePoint,
          newRegime: 'volatile', // 簡易判定
          analysis: regimeAnalysis
        };
      }
      
      return {
        detected: false,
        analysis: regimeAnalysis
      };
      
    } catch (error) {
      return { 
        detected: false, 
        error: error.message 
      };
    }
  }
  
  /**
   * パラメータドリフトを検出
   * @returns {Object} パラメータドリフト検出結果
   */
  async detectParameterDrift() {
    const parameterHistory = this.monitoringData.historicalPerformance
      .slice(-50)
      .map(p => p.parameters)
      .filter(p => Object.keys(p).length > 0);
      
    if (parameterHistory.length < 10) {
      return { detected: false, reason: 'insufficient_data' };
    }
    
    try {
      const driftAnalysis = this.validationComponents.parameterDriftDetector.detectSignificantDrift(parameterHistory);
      
      return {
        detected: driftAnalysis.hasDrift,
        driftScore: driftAnalysis.driftScore,
        threshold: this.config.maxParameterDrift
      };
      
    } catch (error) {
      return { 
        detected: false, 
        error: error.message 
      };
    }
  }
  
  /**
   * アラートと推奨事項を生成
   * @param {Object} validationResults - 検証結果
   */
  async generateAlertsAndRecommendations(validationResults) {
    const alerts = [];
    const recommendations = [];
    
    // パフォーマンス劣化アラート
    if (validationResults.performanceDegradation.detected) {
      alerts.push({
        type: 'performance_degradation',
        severity: 'high',
        message: 'パフォーマンス劣化が検出されました',
        score: validationResults.performanceDegradation.degradationScore,
        timestamp: new Date().toISOString()
      });
      
      recommendations.push({
        type: 'parameter_adjustment',
        priority: 'high',
        message: 'パラメータの再最適化またはポジションサイズの調整を検討してください'
      });
    }
    
    // オーバーフィッティングアラート
    if (validationResults.overfittingRisk.detected) {
      alerts.push({
        type: 'overfitting_risk',
        severity: 'medium',
        message: 'オーバーフィッティングリスクが高まっています',
        score: validationResults.overfittingRisk.overfittingScore,
        timestamp: new Date().toISOString()
      });
      
      recommendations.push({
        type: 'robustness_improvement',
        priority: 'medium',
        message: 'より堅牢なパラメータ設定に変更し、out-of-sample検証を実行してください'
      });
    }
    
    // レジーム変化アラート
    if (validationResults.regimeChange.detected) {
      alerts.push({
        type: 'regime_change',
        severity: 'high',
        message: 'マーケットレジームの変化が検出されました',
        newRegime: validationResults.regimeChange.newRegime,
        timestamp: new Date().toISOString()
      });
      
      recommendations.push({
        type: 'strategy_adaptation',
        priority: 'high',
        message: '戦略パラメータを新しいマーケット環境に適応させる必要があります'
      });
      
      // 適応的調整が有効な場合
      if (this.config.enableAdaptiveAdjustment) {
        await this.performAdaptiveAdjustment(validationResults.regimeChange);
      }
    }
    
    // パラメータドリフトアラート
    if (validationResults.parameterDrift.detected) {
      alerts.push({
        type: 'parameter_drift',
        severity: 'medium',
        message: 'パラメータドリフトが検出されました',
        driftScore: validationResults.parameterDrift.driftScore,
        timestamp: new Date().toISOString()
      });
      
      recommendations.push({
        type: 'parameter_stabilization',
        priority: 'medium',
        message: 'パラメータの安定化またはリバランスを実行してください'
      });
    }
    
    validationResults.alerts = alerts;
    validationResults.recommendations = recommendations;
    
    // アラートを履歴に保存
    this.monitoringData.alerts.push(...alerts);
    
    // アラート履歴の制限
    if (this.monitoringData.alerts.length > 100) {
      this.monitoringData.alerts = this.monitoringData.alerts.slice(-100);
    }
    
    // 高セベリティアラートの場合はイベント発火
    const highSeverityAlerts = alerts.filter(a => a.severity === 'high');
    if (highSeverityAlerts.length > 0) {
      this.emit('high_severity_alert', {
        alerts: highSeverityAlerts,
        recommendations: recommendations.filter(r => r.priority === 'high'),
        timestamp: new Date().toISOString()
      });
    }
  }
  
  /**
   * 適応的調整を実行
   * @param {Object} regimeChangeInfo - レジーム変化情報
   */
  async performAdaptiveAdjustment(regimeChangeInfo) {
    try {
      console.log('🔄 適応的パラメータ調整を実行中...');
      
      // 新しいレジームに基づくパラメータ調整ロジック
      const adjustmentFactor = regimeChangeInfo.newRegime === 'volatile' ? 0.8 : 1.2;
      
      const adjustedParameters = {};
      for (const [key, value] of Object.entries(this.monitoringData.currentParameters)) {
        if (typeof value === 'number') {
          adjustedParameters[key] = Math.round(value * adjustmentFactor);
        } else {
          adjustedParameters[key] = value;
        }
      }
      
      this.emit('adaptive_adjustment', {
        originalParameters: this.monitoringData.currentParameters,
        adjustedParameters,
        regimeChange: regimeChangeInfo,
        adjustmentFactor,
        timestamp: new Date().toISOString()
      });
      
      console.log('✅ 適応的調整が完了しました');
      
    } catch (error) {
      console.error('❌ 適応的調整エラー:', error.message);
      this.emit('adaptive_adjustment_error', error);
    }
  }
  
  /**
   * パフォーマンス指標を計算
   * @param {Array} returns - リターン配列
   * @returns {Object} パフォーマンス指標
   */
  calculatePerformanceMetrics(returns) {
    if (returns.length === 0) return {};
    
    const n = returns.length;
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / n;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (n - 1);
    const volatility = Math.sqrt(variance);
    
    const sharpeRatio = volatility > 0 ? meanReturn / volatility : 0;
    
    // 最大ドローダウン計算
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    
    for (const ret of returns) {
      cumulative += ret;
      peak = Math.max(peak, cumulative);
      const drawdown = peak - cumulative;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }
    
    return {
      meanReturn,
      volatility,
      sharpeRatio,
      maxDrawdown,
      totalReturn: returns.reduce((sum, r) => sum + r, 0),
      count: n
    };
  }
  
  /**
   * パラメータ安定性を分析
   * @param {Array} parameterHistory - パラメータ履歴
   * @returns {number} 不安定性スコア (0-1)
   */
  analyzeParameterStability(parameterHistory) {
    if (parameterHistory.length < 2) return 0;
    
    const parameterKeys = Object.keys(parameterHistory[0] || {});
    if (parameterKeys.length === 0) return 0;
    
    let totalInstability = 0;
    
    for (const key of parameterKeys) {
      const values = parameterHistory.map(p => p[key]).filter(v => typeof v === 'number');
      if (values.length < 2) continue;
      
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
      const cv = Math.abs(mean) > 0 ? Math.sqrt(variance) / Math.abs(mean) : 0;
      
      totalInstability += cv;
    }
    
    return parameterKeys.length > 0 ? Math.min(1, totalInstability / parameterKeys.length) : 0;
  }
  
  /**
   * 監視状況のサマリーを取得
   * @returns {Object} 監視サマリー
   */
  getMonitoringSummary() {
    const recentAlerts = this.monitoringData.alerts.slice(-10);
    const recentPerformance = this.monitoringData.recentReturns.slice(-30);
    
    return {
      isMonitoring: this.isMonitoring,
      totalTrades: this.monitoringData.historicalPerformance.length,
      recentTradeCount: recentPerformance.length,
      recentPerformance: recentPerformance.length > 0 ? this.calculatePerformanceMetrics(recentPerformance) : null,
      alertCount: this.monitoringData.alerts.length,
      recentAlerts,
      lastValidation: this.monitoringData.lastValidation,
      currentRegime: this.monitoringData.regime,
      baseline: this.monitoringData.performanceBaseline
    };
  }
  
  /**
   * Discord用レポートを生成
   * @returns {string} Discord用レポート
   */
  generateDiscordReport() {
    const summary = this.getMonitoringSummary();
    const report = [];
    
    report.push('🔄 **リアルタイム検証システム 状況**');
    report.push('');
    
    const statusEmoji = summary.isMonitoring ? '🟢' : '🔴';
    report.push(`**監視状態:** ${statusEmoji} ${summary.isMonitoring ? 'アクティブ' : '停止中'}`);
    report.push(`**総取引数:** ${summary.totalTrades}`);
    report.push(`**直近取引数:** ${summary.recentTradeCount}`);
    report.push('');
    
    if (summary.recentPerformance) {
      report.push('**直近パフォーマンス:**');
      report.push('```');
      report.push(`Sharpe比率:    ${summary.recentPerformance.sharpeRatio.toFixed(3)}`);
      report.push(`平均リターン:  ${(summary.recentPerformance.meanReturn * 100).toFixed(2)}%`);
      report.push(`最大DD:       ${(summary.recentPerformance.maxDrawdown * 100).toFixed(2)}%`);
      report.push('```');
    }
    
    if (summary.recentAlerts.length > 0) {
      report.push('');
      report.push('**最近のアラート:**');
      
      const alertEmojis = {
        performance_degradation: '📉',
        overfitting_risk: '⚠️',
        regime_change: '🔄',
        parameter_drift: '📊'
      };
      
      summary.recentAlerts.slice(-5).forEach(alert => {
        const emoji = alertEmojis[alert.type] || '🔔';
        report.push(`${emoji} ${alert.message}`);
      });
    } else {
      report.push('');
      report.push('✅ **アラートなし**');
    }
    
    return report.join('\n');
  }
}

module.exports = {
  RealtimeValidationSystem
};