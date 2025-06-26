# ロジック改善提案書

## 1. 負のポジション防止メカニズム

### 1.1 売却時の事前検証
```javascript
// src/common/orderValidation.js に追加
async function validateSellAmount(symbol, amount, strategy) {
  const summary = await getTradeSummary('bitbank', symbol, strategy);
  const netPosition = parseFloat(summary.netPosition || 0);
  
  if (amount > netPosition) {
    throw new Error(`売却量(${amount})がネットポジション(${netPosition})を超過`);
  }
  
  return true;
}
```

### 1.2 トランザクション整合性の確保
```javascript
// src/database/redisDatabase.js の updateTradeSummary を改善
async function updateTradeSummaryWithValidation(exchange, symbol, strategy, updateData) {
  const multi = client.multi();
  
  // 現在の状態を取得
  const current = await getTradeSummary(exchange, symbol, strategy);
  
  // 更新後の計算
  const newNetPosition = calculateNewNetPosition(current, updateData);
  
  // 負のポジションチェック
  if (newNetPosition < 0) {
    throw new Error(`更新により負のポジション(${newNetPosition})が発生`);
  }
  
  // アトミックな更新
  multi.hSet(key, updateData);
  multi.hSet(key, 'netPosition', newNetPosition.toString());
  
  return multi.exec();
}
```

## 2. リアルタイム監視システム

### 2.1 定期的な整合性チェック
```javascript
// src/monitoring/positionMonitor.js
class PositionMonitor {
  async checkNegativePositions() {
    const summaries = await getAllTradeSummaries();
    const negatives = summaries.filter(s => s.netPosition < 0);
    
    if (negatives.length > 0) {
      await notifyDiscord('負のポジション検出', negatives);
      await autoFixNegativePositions(negatives);
    }
  }
}
```

### 2.2 売買イベントフック
```javascript
// src/bot.js に追加
emitter.on('order-filled', async (order) => {
  // 約定後の整合性チェック
  await validatePositionConsistency(order.symbol, order.strategy);
});
```

## 3. データ修復メカニズム

### 3.1 自動修復機能
```javascript
// src/common/autoRepair.js
async function autoRepairNegativePosition(symbol, strategy) {
  // 取引履歴から正しい残高を再計算
  const trades = await getTradeHistory(symbol, strategy);
  const correctPosition = calculatePositionFromTrades(trades);
  
  // サマリーを修正
  await updateTradeSummary(
    'bitbank', 
    symbol, 
    strategy, 
    { netPosition: correctPosition.toString() }
  );
  
  return correctPosition;
}
```

### 3.2 取引履歴からの再構築
```javascript
// scripts/rebuildSummariesFromTrades.js
async function rebuildAllSummaries() {
  const strategies = getEnabledStrategies();
  const symbols = getActiveSymbols();
  
  for (const strategy of strategies) {
    for (const symbol of symbols) {
      const trades = await getAllTradesForStrategy(symbol, strategy);
      const summary = calculateSummaryFromTrades(trades);
      await setTradeSummary('bitbank', symbol, strategy, summary);
    }
  }
}
```

## 4. 予防的措置

### 4.1 注文前の残高確認
```javascript
// src/strategies/baseStrategy.js に追加
async function canSell(symbol, amount) {
  const exchange = await getExchangeBalance(symbol);
  const managed = await getManagedBalance(symbol, this.name);
  
  return amount <= Math.min(exchange.free, managed.netPosition);
}
```

### 4.2 ダブルエントリー記帳
```javascript
// 買い注文と売り注文を必ずペアで管理
class PositionLedger {
  async recordBuy(symbol, amount, price) {
    // デビット: 現物資産増加
    // クレジット: 現金減少
  }
  
  async recordSell(symbol, amount, price) {
    // デビット: 現金増加
    // クレジット: 現物資産減少
    
    // 残高チェック
    if (this.getBalance(symbol) < amount) {
      throw new Error('残高不足');
    }
  }
}
```

## 5. 実装優先順位

1. **即時対応**（優先度: 高）
   - 売却時の事前検証実装
   - 負のポジション自動検出

2. **短期対応**（優先度: 中）
   - トランザクション整合性の確保
   - リアルタイム監視システム

3. **中期対応**（優先度: 低）
   - ダブルエントリー記帳システム
   - 完全な取引履歴からの再構築機能

## 6. テスト計画

### 6.1 単体テスト
- 売却検証ロジックのテスト
- 負のポジション検出テスト
- 自動修復機能のテスト

### 6.2 統合テスト
- 高頻度取引シミュレーション
- 同時売買のストレステスト
- エラー発生時のロールバックテスト

## 7. 監視指標

- 負のポジション発生率
- 自動修復成功率
- 取引所残高との乖離率
- エラー発生頻度