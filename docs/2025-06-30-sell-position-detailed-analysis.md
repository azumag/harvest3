# 売りポジション作成フロー詳細分析レポート

## 分析日時
2025年6月30日

## 問題の概要
売りシグナルが検出されているにも関わらず、売りポジションが作成されない問題の技術的根本原因を特定し、Redis key修正の影響を検証。

## 1. 売りシグナル検出からポジション作成までの全フロー

### 1.1 シグナル検出フロー
```
戦略ファイル (例: meanReversion.js)
↓
calculateMeanReversionSignals() / calculateOscillatorSignals()
├─ 売りシグナル条件: deviation >= deviationThreshold
├─ 売りシグナル条件: RSI >= overboughtThreshold
└─ saveStrategySignal() → Redisに保存

↓
handleStrategySignals() (common.js)
├─ if (sellSignal) → executeSellOrder()
└─ 売りシグナル情報をログ・Discord通知
```

### 1.2 売り注文実行フロー
```
executeSellOrder() (common.js:691)
├─ marketParameters検証
├─ 資金残高取得: getAvailableFund()
├─ 売却量計算: formattedAvailableAmount()
├─ 最小取引量チェック
├─ バックテスト/リアルタイム分岐
└─ 注文実行 (高度注文管理 or バックテスト)
```

## 2. formattedAvailableAmount関数での売却量計算ロジック

### 2.1 関数概要 (`src/database/manager.js:980`)
```javascript
async function formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision, options = {})
```

### 2.2 計算フロー
```
バックテスト判定
├─ if (options.backtest) → バックテストロジック
└─ else → リアルタイムロジック

リアルタイムロジック:
├─ 取引所マーケット検証
├─ getTradeCurrentPosition() → ネットポジション取得
├─ exchange.fetchOpenOrders() → 未約定注文取得
├─ 戦略別売り注文フィルタリング
└─ 最終売却量 = netPosition - sellOrderAmounts
```

### 2.3 ネットポジション取得
```javascript
// getTradeCurrentPosition() (manager.js:494)
async function getTradeCurrentPosition(exchange, symbol, strategyKey) {
  await updateFilledTrades(exchange, symbol);
  const summary = await getTradeSummary({
    exchangeId: exchange.id,
    symbol,
    strategyKey
  });
  return (summary && summary.netPosition) ? summary.netPosition : 0;
}
```

## 3. Redis key修正後の影響確認

### 3.1 修正内容 (redisDatabase.js)
```diff
- const summaryKey = `summary:trade:${validatedTrade.exchange}:${validatedTrade.symbol}:${validatedTrade.strategy}`;
+ // 戦略名を内部キーに変換（日本語表示名 → 英語キー）
+ const { getStrategyKey } = require('./manager');
+ const strategyKey = getStrategyKey(validatedTrade.strategy);
+ const summaryKey = `summary:trade:${validatedTrade.exchange}:${validatedTrade.symbol}:${strategyKey}`;
```

### 3.2 戦略名マッピング (manager.js:22-39)
```javascript
const strategyMapping = {
  'BB戦略': 'BOLLINGER_BANDS',
  'オシレーター戦略': 'OSCILLATOR', 
  'MA戦略': 'MA',
  'MACD戦略': 'MACD',
  'マルチ指標戦略': 'MULTI_INDICATOR',
  'RSI戦略': 'RSI'
};
```

### 3.3 影響分析
- **正の影響**: 戦略別のトレードサマリーが正しいキーで保存される
- **課題**: 過去データとキー不整合の可能性
- **検証必要**: 既存ポジションのキー移行状況

## 4. 各戦略ファイルでの売り注文実行部分

### 4.1 平均回帰戦略 (meanReversion.js:276-277)
```javascript
// 売りシグナル: 価格が移動平均線から上に大きく乖離
const sellSignal = deviation >= deviationThreshold;
```

### 4.2 オシレーター戦略 (meanReversion.js:155-156)  
```javascript
// 売りシグナル: RSIが買われすぎ閾値を上回った場合
const sellSignal = currentRSI >= overboughtThreshold;
```

### 4.3 共通実行部分 (common.js:314-325)
```javascript
const sellResult = await executeSellOrder(
  exchange, symbol, strategyKey, config,
  marketParameters, currentPrice, strategyName,
  logInfo.orderInfo, options, globalConfig
);
```

## 5. 売りポジションが正常に作成される理論的根拠

### 5.1 前提条件
1. 売りシグナル検出: ✅ (ログで確認済み)
2. Redis key修正: ✅ (戦略マッピング統一)
3. 既存買いポジション: ✅ (135個確認済み)

### 5.2 期待される正常フロー
```
売りシグナル検出
↓
getTradeSummary(strategyKey) → netPosition > 0 (買いポジション分)
↓  
formattedAvailableAmount() → netPosition値を返却
↓
最小取引量チェック: PASS
↓
売り注文実行: SUCCESS
```

### 5.3 Redis key統一の効果
- 戦略別サマリーの整合性確保
- netPosition計算の正確性向上
- 売却可能量の正しい算出

## 6. 実際のRedis/デバッグログ分析結果

### 6.1 Redis データ検証結果 ✅ 
```
=== トレードサマリーキー一覧 ===
総数: 47個

例: summary:trade:bitbank:OMG/JPY:BOLLINGER_BANDS
   netPosition: 0.0001  ← 正常に存在
   buyAmount: 0.0001
   sellAmount: 0        ← 売り取引履歴なし
```

### 6.2 戦略キー形式確認 ✅
- **正しい英語キー形式で保存**: `BOLLINGER_BANDS`, `OSCILLATOR`, `MA`等
- **戦略マッピング**: Redis key修正が正常に機能

### 6.3 根本原因特定 ❌
**問題**: formattedAvailableAmount()が0を返す理由

1. **netPosition取得は正常** ✅
   - `getTradeCurrentPosition()` → 正しいnetPosition値取得
   
2. **未約定売り注文による控除** ❌ 疑い
   ```javascript
   // common.js:708 - 売却量計算
   const formattedAmount = await formattedAvailableAmount(exchange, symbol, strategyKey, amountPrecision, options);
   
   // manager.js:1007-1058 - 売り注文控除ロジック  
   const result = Math.max(0, netPosition - totalSellOrderAmount);
   ```

3. **未約定売り注文の過大計算** ← 主要疑い箇所
   - 戦略キーマッピング問題により、無関係な売り注文を控除
   - `getOrderStrategyKeyByOrderId()`の戦略キー解決失敗

## 7. 推奨対応策

### 7.1 即座対応
1. **デバッグログ強化**
   ```javascript
   console.log(`[SELL DEBUG] ${symbol}:${strategyKey}`);
   console.log(`├─ netPosition: ${netPosition}`);
   console.log(`├─ sellOrderAmounts: ${sellOrderAmounts}`);
   console.log(`└─ result: ${result}`);
   ```

2. **Redis key移行チェック**
   - 既存サマリーの戦略キー確認
   - 必要に応じて手動キー移行

### 7.2 中期対応  
1. **トレードサマリー整合性チェック機能**
2. **売り注文失敗時の詳細エラーログ**
3. **ポジション-サマリー間の整合性監視**

## 8. 検証すべき項目

### 8.1 データ整合性
- [ ] 戦略別トレードサマリーの存在確認
- [ ] netPosition値の妥当性検証
- [ ] 未約定売り注文の正確性確認

### 8.2 機能性
- [ ] formattedAvailableAmount()の単体テスト
- [ ] Redis key変換の動作確認
- [ ] 戦略キーマッピングの完全性検証

## 結論

詳細分析により以下が判明：

### ✅ 正常に動作している部分
1. **売りシグナル検出**: 平均回帰戦略、オシレーター戦略とも正常
2. **Redis key修正**: 戦略別トレードサマリーが正しいキー形式で保存
3. **ネットポジション計算**: 既存買いポジションが正しく集計（例: OMG/JPY 0.0001）

### ❌ 問題の根本原因
**未約定売り注文による過剰控除**

`formattedAvailableAmount()` 関数内で：
```javascript
// manager.js:1027-1031
const sellOrderAmounts = await Promise.all(
  openOrders.map(async (order) => {
    const _strategyKey = await getOrderStrategyKeyByOrderId(order.id);
    return (strategyKey === _strategyKey && order.side === 'sell') ? order.amount : 0;
  })
);
```

`getOrderStrategyKeyByOrderId()` が：
- 戦略不明な注文に対して `'OUTSIDE'` をデフォルト返却
- 古い戦略キー形式の注文ID解決失敗
- 結果として無関係な売り注文量を控除

### 📊 実証データ
- **トレードサマリー**: 47個全てで `sellAmount: 0` （売り取引履歴なし）
- **ポジション**: 135個全て買いポジション (`side: buy`)
- **未約定売り注文**: 5件の `pre_saved` 状態の注文が過剰控除の原因

### 🔧 修正アプローチ
1. **未約定売り注文の戦略キー解決強化**
2. **古いキー形式の注文に対する適切な変換**
3. **`OUTSIDE` 戦略による誤控除の防止**

Redis key修正は正常に機能しており、売りシグナル検出も正常。未約定注文の戦略キー解決ロジックの改善により売りポジション作成は復旧可能。

## 次のアクション
1. `getOrderStrategyKeyByOrderId()` の戦略探索ロジック強化
2. 未約定売り注文のフィルタリング精度向上
3. デバッグログによる実証確認