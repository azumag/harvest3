#!/usr/bin/env node

/**
 * スロットル閾値分析スクリプト
 * 実際のAPIレスポンス時間とエラー率からスロットル閾値を科学的に算出
 */

const fs = require('fs');
const path = require('path');

class ThrottleThresholdAnalyzer {
    constructor() {
        this.measurements = [];
        this.errorThresholds = {
            acceptable: 0.05, // 5%のエラー率までは許容
            critical: 0.15    // 15%を超えたら緊急
        };
    }
    
    /**
     * APIレスポンス時間とエラー率のデータを分析
     */
    analyzeHistoricalData() {
        console.log('📊 スロットル閾値の科学的分析開始...');
        
        // 理論値に基づく初期分析（実際の運用では実データを使用）
        const theoreticalData = this.generateTheoreticalData();
        
        console.log('\n=== 理論データに基づく分析 ===');
        console.log('データポイント数:', theoreticalData.length);
        
        const analysis = this.calculateOptimalThresholds(theoreticalData);
        this.displayAnalysisResults(analysis);
        
        return analysis;
    }
    
    /**
     * 理論データの生成（実環境では実データを使用）
     */
    generateTheoreticalData() {
        const data = [];
        
        // キュー使用率 0-100% での理論的なエラー率とレスポンス時間
        for (let queueUsage = 0; queueUsage <= 100; queueUsage += 5) {
            // キュー使用率が高くなるほどエラー率とレスポンス時間が指数関数的に増加
            const errorRate = Math.pow(queueUsage / 100, 3) * 0.5; // 3乗で急激な増加
            const responseTime = 100 + (queueUsage * queueUsage / 10); // 平方で増加
            
            data.push({
                queueUsage: queueUsage / 100,
                errorRate,
                responseTime,
                timestamp: Date.now() - (100 - queueUsage) * 1000
            });
        }
        
        return data;
    }
    
    /**
     * 最適閾値の計算
     */
    calculateOptimalThresholds(data) {
        const analysis = {
            warningThreshold: null,
            criticalThreshold: null,
            reasoning: {},
            confidence: null
        };
        
        // 警告閾値: エラー率が許容範囲を超える直前のポイント
        const warningPoint = data.find(point => point.errorRate > this.errorThresholds.acceptable);
        if (warningPoint) {
            analysis.warningThreshold = Math.max(0.1, warningPoint.queueUsage - 0.1); // 10%のマージン
            analysis.reasoning.warning = `エラー率${(this.errorThresholds.acceptable * 100).toFixed(1)}%超過の10%前で警告`;
        }
        
        // 緊急閾値: エラー率が緊急レベルを超える直前のポイント
        const criticalPoint = data.find(point => point.errorRate > this.errorThresholds.critical);
        if (criticalPoint) {
            analysis.criticalThreshold = Math.max(0.2, criticalPoint.queueUsage - 0.05); // 5%のマージン
            analysis.reasoning.critical = `エラー率${(this.errorThresholds.critical * 100).toFixed(1)}%超過の5%前で緊急対処`;
        }
        
        // レスポンス時間による検証
        const responseTimeThreshold = data.find(point => point.responseTime > 1000); // 1秒超過
        if (responseTimeThreshold) {
            analysis.reasoning.responseTime = `レスポンス時間1秒超過点: ${(responseTimeThreshold.queueUsage * 100).toFixed(1)}%`;
        }
        
        // 分析メタデータ（客観的指標）
        analysis.metadata = this.getAnalysisMetadata(data, analysis);
        
        return analysis;
    }
    
    /**
     * 分析メタデータの取得（客観的指標）
     */
    getAnalysisMetadata(data, analysis) {
        const thresholdGap = analysis.criticalThreshold - analysis.warningThreshold;
        
        return {
            dataPoints: data.length,
            analysisDate: new Date().toISOString(),
            dataType: 'theoretical', // 'theoretical' | 'historical' | 'mixed'
            timespan: {
                start: Math.min(...data.map(d => d.timestamp)),
                end: Math.max(...data.map(d => d.timestamp)),
                duration: '理論値のため該当なし'
            },
            thresholds: {
                warningThreshold: analysis.warningThreshold,
                criticalThreshold: analysis.criticalThreshold,
                gap: thresholdGap,
                gapIsAppropriate: thresholdGap >= 0.1 && thresholdGap <= 0.3
            },
            validation: {
                errorRateAtWarning: this.getErrorRateAtThreshold(data, analysis.warningThreshold),
                errorRateAtCritical: this.getErrorRateAtThreshold(data, analysis.criticalThreshold),
                responseTimeAtWarning: this.getResponseTimeAtThreshold(data, analysis.warningThreshold),
                responseTimeAtCritical: this.getResponseTimeAtThreshold(data, analysis.criticalThreshold)
            },
            limitations: [
                'データは理論モデルに基づく',
                '実環境での検証が必要',
                '負荷パターンによって結果が変動する可能性',
                '最低30日間の実データ収集を強く推奨'
            ],
            nextSteps: [
                '実環境でのデータ収集開始',
                '週次での閾値見直し',
                'A/Bテストによる最適化',
                '異常時の自動調整ログ分析'
            ]
        };
    }
    
    /**
     * 指定閾値でのエラー率取得
     */
    getErrorRateAtThreshold(data, threshold) {
        const point = data.find(d => Math.abs(d.queueUsage - threshold) < 0.05);
        return point ? point.errorRate : null;
    }
    
    /**
     * 指定閾値でのレスポンス時間取得
     */
    getResponseTimeAtThreshold(data, threshold) {
        const point = data.find(d => Math.abs(d.queueUsage - threshold) < 0.05);
        return point ? point.responseTime : null;
    }
    
    /**
     * 分析結果の表示
     */
    displayAnalysisResults(analysis) {
        console.log('\n=== 閾値分析結果 ===');
        console.log(`警告閾値: ${(analysis.warningThreshold * 100).toFixed(1)}%`);
        console.log(`緊急閾値: ${(analysis.criticalThreshold * 100).toFixed(1)}%`);
        console.log(`データ種別: ${analysis.metadata.dataType}`);
        console.log(`データポイント: ${analysis.metadata.dataPoints}個`);
        console.log(`分析日時: ${analysis.metadata.analysisDate}`);
        
        console.log('\n=== 根拠 ===');
        Object.entries(analysis.reasoning).forEach(([key, reason]) => {
            console.log(`${key}: ${reason}`);
        });
        
        console.log('\n=== 推奨設定 ===');
        console.log('```javascript');
        console.log('const throttleConfig = {');
        console.log(`    warningThreshold: ${analysis.warningThreshold.toFixed(2)}, // ${(analysis.warningThreshold * 100).toFixed(1)}%`);
        console.log(`    criticalThreshold: ${analysis.criticalThreshold.toFixed(2)}, // ${(analysis.criticalThreshold * 100).toFixed(1)}%`);
        console.log('};');
        console.log('```');
        
        // 現在の設定との比較
        const currentWarning = 0.8;
        const currentCritical = 0.95;
        
        console.log('\n=== 現在設定との比較 ===');
        console.log(`警告: 現在${(currentWarning * 100)}% → 推奨${(analysis.warningThreshold * 100).toFixed(1)}% (差: ${((analysis.warningThreshold - currentWarning) * 100).toFixed(1)}%)`);
        console.log(`緊急: 現在${(currentCritical * 100)}% → 推奨${(analysis.criticalThreshold * 100).toFixed(1)}% (差: ${((analysis.criticalThreshold - currentCritical) * 100).toFixed(1)}%)`);
        
        console.log('\n=== 検証データ ===');
        const validation = analysis.metadata.validation;
        if (validation.errorRateAtWarning !== null) {
            console.log(`警告時エラー率: ${(validation.errorRateAtWarning * 100).toFixed(2)}%`);
        }
        if (validation.errorRateAtCritical !== null) {
            console.log(`緊急時エラー率: ${(validation.errorRateAtCritical * 100).toFixed(2)}%`);
        }
        if (validation.responseTimeAtWarning !== null) {
            console.log(`警告時レスポンス時間: ${validation.responseTimeAtWarning.toFixed(0)}ms`);
        }
        if (validation.responseTimeAtCritical !== null) {
            console.log(`緊急時レスポンス時間: ${validation.responseTimeAtCritical.toFixed(0)}ms`);
        }
        
        console.log('\n=== 制限事項 ===');
        analysis.metadata.limitations.forEach((limitation, index) => {
            console.log(`${index + 1}. ${limitation}`);
        });
        
        console.log('\n=== 推奨次ステップ ===');
        analysis.metadata.nextSteps.forEach((step, index) => {
            console.log(`${index + 1}. ${step}`);
        });
    }
    
    /**
     * 実データ収集の推奨事項
     */
    recommendDataCollection() {
        console.log('\n=== 実データ収集の推奨事項 ===');
        console.log('1. APIレスポンス時間の継続的記録');
        console.log('2. エラー率の時系列データ');
        console.log('3. キュー使用率とパフォーマンスの相関分析');
        console.log('4. 異なる負荷条件下でのテスト');
        console.log('5. 最低30日間のデータ収集を推奨');
        
        console.log('\n実装例:');
        console.log('```javascript');
        console.log('// データ収集コード');
        console.log('monitor.on("api:response", (data) => {');
        console.log('    collectMetrics({');
        console.log('        queueUsage: data.queueSize / maxQueueSize,');
        console.log('        responseTime: data.responseTime,');
        console.log('        success: !data.error,');
        console.log('        timestamp: Date.now()');
        console.log('    });');
        console.log('});');
        console.log('```');
    }
}

// スクリプト実行
if (require.main === module) {
    const analyzer = new ThrottleThresholdAnalyzer();
    const analysis = analyzer.analyzeHistoricalData();
    analyzer.recommendDataCollection();
    
    // 分析結果をファイルに保存
    const outputFile = path.join(__dirname, '../docs/throttle-threshold-analysis.json');
    fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2));
    console.log(`\n📝 分析結果を保存: ${outputFile}`);
}

module.exports = ThrottleThresholdAnalyzer;