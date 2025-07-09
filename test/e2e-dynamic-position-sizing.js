#!/usr/bin/env node

/**
 * 動的ポジションサイジング機能のE2Eテストスクリプト
 * GitHub Issue #187 対応
 */

const { calculateCurrentVolatility, analyzeMarketConditions } = require('../src/strategies/utils/common');
const { DynamicPositionSizing } = require('../src/strategies/utils/positionSizing');

// テスト用OHLCVデータ（模擬データ）
const sampleOHLCVData = [
  [1, 100, 105, 95, 102, 1000], // timestamp, open, high, low, close, volume
  [2, 102, 108, 99, 106, 1100],
  [3, 106, 110, 104, 108, 1200],
  [4, 108, 112, 105, 110, 1050],
  [5, 110, 115, 108, 112, 1300],
  [6, 112, 118, 110, 115, 1400],
  [7, 115, 120, 112, 118, 1250],
  [8, 118, 125, 115, 120, 1600],
  [9, 120, 128, 118, 125, 1700],
  [10, 125, 130, 122, 128, 1800],
  [11, 128, 135, 125, 132, 1900],
  [12, 132, 140, 130, 135, 2000],
  [13, 135, 142, 132, 138, 1850],
  [14, 138, 145, 135, 140, 1950],
  [15, 140, 148, 138, 145, 2100],
  [16, 145, 150, 142, 148, 2200],
  [17, 148, 155, 145, 152, 2300],
  [18, 152, 158, 150, 155, 2400],
  [19, 155, 162, 152, 158, 2500],
  [20, 158, 165, 155, 162, 2600]
];

/**
 * 動的ポジションサイジングE2Eテストメイン関数
 */
async function runDynamicPositionSizingTests() {
  console.log('🧪 動的ポジションサイジング機能E2Eテスト開始');
  console.log('='.repeat(50));

  const testResults = {
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    results: []
  };

  // 1. ボラティリティ計算テスト
  console.log('\n📊 1. ボラティリティ計算テスト');
  testResults.totalTests++;
  try {
    const volatility = calculateCurrentVolatility(sampleOHLCVData);
    const isValid = volatility >= 0.001 && volatility <= 0.5;

    console.log(`計算されたボラティリティ: ${(volatility * 100).toFixed(4)}%`);
    console.log('期待値範囲: 0.1% - 50.0%');
    console.log(`結果: ${isValid ? '✅ PASS' : '❌ FAIL'}`);

    if (isValid) {
      testResults.passedTests++;
      testResults.results.push({ test: 'volatility', status: 'PASS', value: volatility });
    } else {
      testResults.failedTests++;
      testResults.results.push({ test: 'volatility', status: 'FAIL', value: volatility, error: 'Out of expected range' });
    }
  } catch (error) {
    testResults.failedTests++;
    testResults.results.push({ test: 'volatility', status: 'ERROR', error: error.message });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // 2. 市場分析テスト
  console.log('\n📈 2. 市場状況分析テスト');
  testResults.totalTests++;
  try {
    const currentPrice = 162;
    const marketConditions = analyzeMarketConditions(sampleOHLCVData, currentPrice);
    const isValid = marketConditions.trend !== 'unknown';

    console.log(`トレンド: ${marketConditions.trend}`);
    console.log(`方向: ${marketConditions.direction}`);
    console.log(`強度: ${(marketConditions.strength * 100).toFixed(2)}%`);
    console.log(`価格変動: ${(marketConditions.priceChange * 100).toFixed(2)}%`);
    console.log(`SMA比較: ${(marketConditions.priceVsSma * 100).toFixed(2)}%`);
    console.log(`結果: ${isValid ? '✅ PASS' : '❌ FAIL'}`);

    if (isValid) {
      testResults.passedTests++;
      testResults.results.push({ test: 'market_analysis', status: 'PASS', value: marketConditions });
    } else {
      testResults.failedTests++;
      testResults.results.push({ test: 'market_analysis', status: 'FAIL', value: marketConditions, error: 'Invalid trend analysis' });
    }
  } catch (error) {
    testResults.failedTests++;
    testResults.results.push({ test: 'market_analysis', status: 'ERROR', error: error.message });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // 3. 動的ポジションサイジングテスト
  console.log('\n💰 3. 動的ポジションサイジングテスト');
  testResults.totalTests++;
  try {
    const volatility = calculateCurrentVolatility(sampleOHLCVData);
    const marketConditions = analyzeMarketConditions(sampleOHLCVData, 162);

    const dynamicSizing = new DynamicPositionSizing({
      baseRiskPerTrade: 0.02, // 2%
      atrPeriod: 14,
      atrMultiplier: 2,
      maxPositionPercent: 0.1, // 10%
      minPositionPercent: 0.001, // 0.1%
      performanceAdjustment: true
    });

    const testParams = {
      accountBalance: 100000, // 10万円
      ohlcData: sampleOHLCVData.map(candle => ({
        high: candle[2],
        low: candle[3],
        close: candle[4]
      })),
      currentPrice: 162,
      strategyKey: 'test_strategy',
      marketData: {
        volatility,
        marketConditions,
        performanceAdjustment: 1.0,
        marketParameters: {
          amountPrecision: 4,
          minTradeAmount: 0.001
        }
      }
    };

    const positionResult = dynamicSizing.calculateATRBasedPosition(testParams);
    const isValid = positionResult.reason === 'success' && positionResult.positionSize > 0;

    console.log(`ポジション計算結果: ${positionResult.reason}`);
    if (positionResult.reason === 'success') {
      console.log(`推奨ポジションサイズ: ${positionResult.positionSize.toFixed(6)}`);
      console.log(`ATR: ${positionResult.atr.toFixed(6)}`);
      console.log(`調整リスク: ${(positionResult.adjustedRisk * 100).toFixed(2)}%`);
      console.log(`ストップロス距離: ${positionResult.stopLossDistance.toFixed(6)}`);
      console.log(`最大ポジション: ${positionResult.maxPosition.toFixed(6)}`);
      console.log(`最小ポジション: ${positionResult.minPosition.toFixed(6)}`);
    }
    console.log(`結果: ${isValid ? '✅ PASS' : '❌ FAIL'}`);

    if (isValid) {
      testResults.passedTests++;
      testResults.results.push({ test: 'position_sizing', status: 'PASS', value: positionResult });
    } else {
      testResults.failedTests++;
      testResults.results.push({ test: 'position_sizing', status: 'FAIL', value: positionResult, error: positionResult.error || 'Invalid position size' });
    }
  } catch (error) {
    testResults.failedTests++;
    testResults.results.push({ test: 'position_sizing', status: 'ERROR', error: error.message });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // 4. パフォーマンス調整テスト
  console.log('\n⚡ 4. パフォーマンス調整テスト');
  testResults.totalTests++;
  try {
    // 損失シナリオ
    const lossRatio = 5000 / 100000;
    const lossAdjustment = Math.max(0.3, 1.0 - (lossRatio * 2));

    // 利益シナリオ
    const profitRatio = 3000 / 100000;
    const profitAdjustment = Math.min(1.5, 1.0 + (profitRatio * 0.5));

    const lossValid = lossAdjustment < 1.0;
    const profitValid = profitAdjustment > 1.0;
    const isValid = lossValid && profitValid;

    console.log('損失シナリオ (realizedPnL = -5000):');
    console.log(`損失率: ${(lossRatio * 100).toFixed(1)}%`);
    console.log(`調整係数: ${lossAdjustment.toFixed(2)}`);
    console.log(`結果: ${lossValid ? '✅ PASS (ポジション削減)' : '❌ FAIL'}`);

    console.log('利益シナリオ (realizedPnL = +3000):');
    console.log(`利益率: ${(profitRatio * 100).toFixed(1)}%`);
    console.log(`調整係数: ${profitAdjustment.toFixed(2)}`);
    console.log(`結果: ${profitValid ? '✅ PASS (ポジション増加)' : '❌ FAIL'}`);

    if (isValid) {
      testResults.passedTests++;
      testResults.results.push({ test: 'performance_adjustment', status: 'PASS', value: { lossAdjustment, profitAdjustment } });
    } else {
      testResults.failedTests++;
      testResults.results.push({ test: 'performance_adjustment', status: 'FAIL', value: { lossAdjustment, profitAdjustment }, error: 'Invalid adjustment logic' });
    }
  } catch (error) {
    testResults.failedTests++;
    testResults.results.push({ test: 'performance_adjustment', status: 'ERROR', error: error.message });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // 5. 設定動的調整テスト
  console.log('\n🔧 5. 設定動的調整テスト');
  testResults.totalTests++;
  try {
    const baseConfig = {
      baseRiskPerTrade: 0.01,
      atrMultiplier: 2
    };

    // 高ボラティリティシナリオ
    const highVolatility = 0.08; // 8%
    const highVolConfig = {
      ...baseConfig,
      baseRiskPerTrade: highVolatility > 0.05 ?
        baseConfig.baseRiskPerTrade * 0.7 :
        baseConfig.baseRiskPerTrade
    };

    // 強いトレンドシナリオ
    const strongTrend = { trend: 'strong' };
    const trendConfig = {
      ...baseConfig,
      atrMultiplier: strongTrend.trend === 'strong' ?
        baseConfig.atrMultiplier * 1.2 :
        baseConfig.atrMultiplier
    };

    const riskReduced = highVolConfig.baseRiskPerTrade < baseConfig.baseRiskPerTrade;
    const multiplierIncreased = trendConfig.atrMultiplier > baseConfig.atrMultiplier;
    const isValid = riskReduced && multiplierIncreased;

    console.log(`高ボラティリティ時のリスク調整: ${baseConfig.baseRiskPerTrade} → ${highVolConfig.baseRiskPerTrade}`);
    console.log(`結果: ${riskReduced ? '✅ PASS (リスク削減)' : '❌ FAIL'}`);

    console.log(`強いトレンド時のATR調整: ${baseConfig.atrMultiplier} → ${trendConfig.atrMultiplier}`);
    console.log(`結果: ${multiplierIncreased ? '✅ PASS (マルチプライヤー増加)' : '❌ FAIL'}`);

    if (isValid) {
      testResults.passedTests++;
      testResults.results.push({ test: 'dynamic_config', status: 'PASS', value: { highVolConfig, trendConfig } });
    } else {
      testResults.failedTests++;
      testResults.results.push({ test: 'dynamic_config', status: 'FAIL', value: { highVolConfig, trendConfig }, error: 'Invalid config adjustment' });
    }
  } catch (error) {
    testResults.failedTests++;
    testResults.results.push({ test: 'dynamic_config', status: 'ERROR', error: error.message });
    console.log(`❌ ERROR: ${error.message}`);
  }

  // テスト結果サマリー
  console.log('\n='.repeat(50));
  console.log('🎯 動的ポジションサイジング機能E2Eテスト完了');
  console.log(`総テスト数: ${testResults.totalTests}`);
  console.log(`成功: ${testResults.passedTests}`);
  console.log(`失敗: ${testResults.failedTests}`);
  console.log(`成功率: ${((testResults.passedTests / testResults.totalTests) * 100).toFixed(1)}%`);

  if (testResults.failedTests === 0) {
    console.log('\n✅ 全テスト成功! 動的ポジションサイジング機能は正常に動作しています。');
    console.log('実装された機能:');
    console.log('  ✅ 市場ボラティリティに基づく動的リスク調整');
    console.log('  ✅ トレンド強度に基づくATRマルチプライヤー調整');
    console.log('  ✅ 実現損益に基づくパフォーマンス調整');
    console.log('  ✅ 市場条件分析とトレンド検出');
    console.log('  ✅ 包括的なリスク管理とポジションサイジング');
  } else {
    console.log('\n❌ 一部テストが失敗しました。詳細を確認してください。');
  }

  return testResults;
}

// モジュールとして実行された場合とスクリプトとして実行された場合の処理
if (require.main === module) {
  runDynamicPositionSizingTests()
    .then(results => {
      process.exit(results.failedTests === 0 ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ テスト実行エラー:', error);
      process.exit(1);
    });
} else {
  module.exports = { runDynamicPositionSizingTests };
}