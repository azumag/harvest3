# 動的Urgency調整システム設計書

## 概要

従来の固定urgency設定から、市場状況・ポートフォリオ・戦略パフォーマンスに基づく動的調整システムへの拡張。

## システムアーキテクチャ

### 1. DynamicUrgencyCalculator クラス
```javascript
class DynamicUrgencyCalculator {
  // メイン計算エンジン
  calculateDynamicUrgency(symbol, baseUrgency, context)
  
  // 各要素の計算
  calculateVolatilityFactor(symbol)
  calculatePortfolioRiskFactor()
  calculateTimezoneFactor()
  calculatePerformanceFactor(strategy)
  
  // 統合・重み付け
  combineFactors(factors, weights)
}
```

### 2. 要素別計算モジュール

#### A. 市場ボラティリティ (VolatilityAnalyzer)
```javascript
class VolatilityAnalyzer {
  // ATR（Average True Range）ベースの計算
  calculateATR(ohlcvData, period = 14)
  
  // 価格変動率の標準偏差
  calculatePriceVolatility(priceData, period = 20)
  
  // ボラティリティランク（0-1）
  getVolatilityRank(currentVol, historicalVol)
}
```

#### B. ポートフォリオリスク (PortfolioRiskAnalyzer)
```javascript
class PortfolioRiskAnalyzer {
  // 現在のドローダウン率
  getCurrentDrawdown()
  
  // リスク限界接近度（0-1）
  getRiskProximity()
  
  // ポジション集中度
  getPositionConcentration()
}
```

#### C. 時間帯分析 (TimezoneAnalyzer)
```javascript
class TimezoneAnalyzer {
  // 市場活発度スコア
  getMarketActivityScore(timestamp)
  
  // 流動性期待値
  getLiquidityExpectation(hour, market)
  
  // 時間帯別調整係数
  getTimezoneMultiplier(timestamp)
}
```

#### D. 戦略パフォーマンス (PerformanceAnalyzer)
```javascript
class PerformanceAnalyzer {
  // 戦略別成績評価
  getStrategyPerformance(strategyName, lookbackPeriod)
  
  // 最近の成功率
  getRecentSuccessRate(strategyName, trades = 10)
  
  // パフォーマンス調整係数
  getPerformanceMultiplier(performance)
}
```

## 計算フロー

### 1. ベースライン取得
```javascript
// 現在の設定ベースurgency
const baseUrgency = getBaseUrgency(orderType, config);
```

### 2. 要素別計算
```javascript
const factors = {
  volatility: volatilityAnalyzer.getVolatilityRank(symbol),
  portfolioRisk: portfolioAnalyzer.getRiskProximity(),
  timezone: timezoneAnalyzer.getMarketActivityScore(Date.now()),
  performance: performanceAnalyzer.getRecentSuccessRate(strategy)
};
```

### 3. 重み付け統合
```javascript
const weights = {
  volatility: 0.3,     // 30%
  portfolioRisk: 0.25, // 25%
  timezone: 0.2,       // 20%
  performance: 0.25    // 25%
};

const adjustmentFactor = combineFactors(factors, weights);
```

### 4. 最終urgency決定
```javascript
const dynamicUrgency = applyAdjustment(baseUrgency, adjustmentFactor);
```

## 調整ロジック詳細

### 1. ボラティリティ調整
```javascript
// 高ボラティリティ時の調整
if (volatilityRank > 0.8) {
  urgencyMultiplier += 0.5; // より積極的
} else if (volatilityRank < 0.2) {
  urgencyMultiplier -= 0.3; // より慎重
}
```

### 2. リスク状況調整
```javascript
// リスク限界近接時の調整
if (riskProximity > 0.8) {
  urgencyMultiplier -= 0.4; // 慎重モード
} else if (riskProximity < 0.3) {
  urgencyMultiplier += 0.2; // 積極モード
}
```

### 3. 時間帯調整
```javascript
// 市場活発時間帯
const hour = new Date().getHours();
if (hour >= 9 && hour <= 15) { // 日本市場時間
  urgencyMultiplier += 0.1;
} else if (hour >= 22 || hour <= 6) { // 流動性低下時間
  urgencyMultiplier -= 0.2;
}
```

### 4. パフォーマンス調整
```javascript
// 戦略不調時の調整
if (successRate < 0.4) {
  urgencyMultiplier -= 0.3; // 慎重モード
} else if (successRate > 0.7) {
  urgencyMultiplier += 0.2; // 積極モード
}
```

## 設定パラメータ

### dynamicUrgency設定
```javascript
dynamicUrgency: {
  enabled: true,
  
  // 要素別重み
  weights: {
    volatility: 0.3,
    portfolioRisk: 0.25,
    timezone: 0.2,
    performance: 0.25
  },
  
  // 調整範囲制限
  adjustmentLimits: {
    min: -0.5,  // 最大50%ダウン調整
    max: 0.8    // 最大80%アップ調整
  },
  
  // キャッシュ設定
  cacheDuration: 60000, // 1分間キャッシュ
  
  // 計算パラメータ
  volatilityPeriod: 14,
  performanceLookback: 10,
  timezoneBonus: 0.1
}
```

## 統合ポイント

### 1. common.js修正
```javascript
// 既存のurgency決定ロジックに動的調整を統合
const dynamicUrgencyCalculator = new DynamicUrgencyCalculator(config);
const adjustedUrgency = dynamicUrgencyCalculator.calculateDynamicUrgency(
  symbol, baseUrgency, { strategyName, exchange }
);
```

### 2. パフォーマンスの最適化
- 計算結果の1分間キャッシュ
- 非同期計算と並列処理
- 重い計算の間隔制御

## 監視とデバッグ

### 1. ログ出力
```javascript
console.log(`[Dynamic Urgency] ${symbol}: base=${baseUrgency}, 
  factors=${JSON.stringify(factors)}, 
  final=${finalUrgency}`);
```

### 2. Redis状態保存
```javascript
// 計算結果をRedisに保存（分析用）
redis.hset(`urgency_calc:${symbol}:${timestamp}`, {
  baseUrgency,
  volatilityFactor,
  riskFactor,
  timezoneFactor,
  performanceFactor,
  finalUrgency
});
```

## 段階的展開

### Phase 1: 基本実装
1. DynamicUrgencyCalculator クラス
2. ボラティリティ計算
3. 簡単な統合

### Phase 2: 拡張機能
1. ポートフォリオリスク評価
2. 時間帯分析
3. 詳細ログとモニタリング

### Phase 3: 高度機能
1. 戦略パフォーマンス連動
2. 機械学習ベースの最適化
3. A/Bテスト機能

## 期待される効果

1. **適応性向上**: 市場状況に応じた最適な注文戦略
2. **リスク管理**: 高リスク時の自動的な慎重モード
3. **効率性**: 市場活発時の積極的な約定狙い
4. **学習効果**: 戦略パフォーマンスからのフィードバック

## リスク要因

1. **複雑性増加**: デバッグとメンテナンスの困難
2. **計算負荷**: リアルタイム計算のパフォーマンス影響
3. **誤判断**: 不正確な要素計算による逆効果
4. **過剰最適化**: 過去データへの過度な適合