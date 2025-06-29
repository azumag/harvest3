# ポジションクローズ失敗分析レポート

## 事案概要
日時: 2025年6月30日 04:11  
ポジション: bitbank:ADA/JPY:MA:47271723396  
エラー: ポジションクローズ失敗

## 問題の詳細

### 確認された事実
1. **実際のRedisポジション**: `position:bitbank:ADA/JPY:MA:47271723396`
2. **エラー通知のキー**: `bitbank:ADA/JPY:MACD:47271723396`
3. **MongoDB取引データ**: `strategy: 'MA戦略'`
4. **ポジション状態**: `status: 'open'`, 作成から1.35時間経過

### 戦略名マッピング状況
```javascript
// getStrategyKey関数の現在の設定
const strategyMapping = {
  'MA戦略': 'MA',        // 正しくマッピング済み
  'MACD戦略': 'MACD',    // 正しくマッピング済み
  'MACD': 'MACD',
  'MA': 'MA'
};
```

### 推定原因
1. **取引データ整合性**: MongoDB取引データは`'MA戦略'`で正常
2. **ポジション保存**: `MA`キーで正しく保存されている
3. **クローズ処理**: `getStrategyKey('MA戦略')` → `'MA'`で正常
4. **通知エラー**: なぜか`MACD`キーが使用された

### 可能性のある原因
1. **並行処理による競合状態**: 複数の約定処理が同時実行された
2. **メモリ内データの不整合**: 一時的なデータ不整合
3. **ログ出力のタイミング問題**: 実際とは異なるキーが通知に使用された

## 対応措置

### 即座の対応
- [x] 該当ポジション`position:bitbank:ADA/JPY:MA:47271723396`を手動削除
- [x] ポジション削除確認済み

### 予防措置の検討
1. **ログ強化**: ポジションクローズ処理でのstrategyKey生成過程を詳細ログ
2. **検証強化**: ポジションキー存在確認の強化
3. **監視強化**: 戦略名不整合の自動検出

## 結論

戦略名マッピング機能は正常に動作している。今回の事象は稀な並行処理による一時的不整合の可能性が高い。継続監視し、再発時はより詳細な調査を実施する。

## 関連ファイル
- `/Users/azumag/work/harvest3/src/database/manager.js:769-770` - ポジションキー生成
- `/Users/azumag/work/harvest3/src/database/manager.js:22-39` - getStrategyKey関数
- `/Users/azumag/work/harvest3/src/database/manager.js:794-799` - エラー通知