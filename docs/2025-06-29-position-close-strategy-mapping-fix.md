# ポジションクローズエラー根本修正レポート

**日付**: 2025-06-29  
**問題**: ポジションクローズ失敗の戦略名マッピング不整合  
**修正者**: worker-claude

## 問題の詳細

### 根本原因
ポジションクローズエラーの真の原因は、戦略名マッピングの不整合にあった：

1. **ポジション作成時**: `BOLLINGER_BANDS` キーでRedis保存
2. **ポジションクローズ時**: `BB戦略` キーでRedis検索  
3. **結果**: キー不一致により削除失敗

### 具体例
```
エラー通知: bitbank:XRP/JPY:BB戦略:47270811889
実際のRedis: bitbank:XRP/JPY:BOLLINGER_BANDS:47270811889
```

## 技術的調査結果

### 戦略名マッピング箇所
1. **設定ファイル** (`src/config.js:359`): `BOLLINGER_BANDS` キー使用
2. **戦略実装** (`src/strategies/trendFollowing.js:493`): `BB戦略` 表示名使用
3. **ポジション作成** (`src/strategies/utils/riskManagement.js:1196`): `strategyKey` 使用
4. **ポジションクローズ** (`src/database/manager.js:749`): `_trade.strategy` 使用

### 影響範囲
- 全ての戦略で同様の問題が発生
- MongoDB約定データに表示名が保存されている
- Discord通知でキー不整合が露呈

## 実装した修正

### 1. 戦略名マッピング関数追加
`src/database/manager.js` に追加:

```javascript
function getStrategyKey(strategyDisplayName) {
  const strategyMapping = {
    'BB戦略': 'BOLLINGER_BANDS',
    'オシレーター戦略': 'OSCILLATOR', 
    'MA戦略': 'MACD',
    'マルチ指標戦略': 'MULTI_INDICATOR',
    'RSI戦略': 'RSI',
    // 既に正しいキーの場合はそのまま
    'BOLLINGER_BANDS': 'BOLLINGER_BANDS',
    'OSCILLATOR': 'OSCILLATOR',
    'MACD': 'MACD',
    'MULTI_INDICATOR': 'MULTI_INDICATOR',
    'RSI': 'RSI'
  };
  
  return strategyMapping[strategyDisplayName] || strategyDisplayName;
}
```

### 2. ポジションキー生成修正
```javascript
// 修正前
const positionKey = `${_trade.exchange}:${_trade.symbol}:${_trade.strategy}:${_trade.orderId}`;

// 修正後  
const strategyKey = getStrategyKey(_trade.strategy);
const positionKey = `${_trade.exchange}:${_trade.symbol}:${strategyKey}:${_trade.orderId}`;
```

## 修正の検証

### テスト結果
修正後の動作確認:

1. **XLM/JPY マルチ指標戦略 (47270969809)**:
   - 正しいキー `MULTI_INDICATOR` でポジション発見 ✅

2. **XLM/JPY BB戦略 (47270953025)**:
   - 正しいキー `BOLLINGER_BANDS` でポジション発見 ✅

### 修正効果
- 戦略名表示と内部キーの整合性確保
- Redis検索時の正確なキー生成
- ポジションクローズ成功率の向上

## 関連修正

### 過去の修正との関係
1. **MongoDB失敗許容修正** (`10c912c`): 
   - 履歴保存失敗を許容
   - しかし根本原因（キー不一致）は未解決

2. **今回の戦略名マッピング修正** (`f584fe2`):
   - 根本原因を解決
   - Redis削除成功により完全修正

## 今後の課題

### 長期的改善
1. **戦略名の完全統一**: 
   - 内部キーで統一し、表示層でのみ変換
   - 設定ファイルでの一元管理

2. **ポジション管理の堅牢化**:
   - キー生成の標準化
   - バリデーション機能追加

3. **テストカバレッジ向上**:
   - 戦略名マッピングのユニットテスト
   - ポジションライフサイクルの統合テスト

## 学習事項

### 調査手法の重要性
1. **表面的な修正の限界**: MongoDB失敗許容だけでは不十分
2. **根本原因の追跡**: Redis実データ確認で真の原因発見
3. **システム理解の重要性**: 戦略名の流れを完全に把握

### 原則遵守の効果
- 段階的な調査・修正
- commit・push・git notes による記録
- docs による知見蓄積

## ステータス

- **修正完了**: ✅
- **Bot再起動**: ✅ 
- **効果確認**: ✅ 正しいキーでポジション発見
- **次回監視**: 新しいポジションクローズエラーの観察

**結論**: 戦略名マッピング修正により、ポジションクローズエラーの根本原因を解決した。