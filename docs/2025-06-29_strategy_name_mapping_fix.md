# Strategy Name Mapping Fix - 2025-06-29

## 問題の概要

Discord で報告されたポジションクローズ失敗エラー:
- エラーメッセージ: `Position key: bitbank:ADA/JPY:MACD:47271723396`
- 実際のRedisポジション: `position:bitbank:ADA/JPY:MA:47271723396`

## 原因

1. **ポジション作成時**: `config.js` で定義された戦略キー `"MA"` を使用
2. **ポジションクローズ時**: `getStrategyKey("MA戦略")` が `"MACD"` を返していた
3. **結果**: ポジションキーの不一致でポジションが見つからない

## 修正内容

`src/database/manager.js` の `getStrategyKey` 関数を修正:

```javascript
// 修正前
'MA戦略': 'MACD',  // 誤ったマッピング

// 修正後  
'MA戦略': 'MA',    // 正しいマッピング
'MACD戦略': 'MACD', // MACD戦略用のマッピングも追加
```

## 影響範囲

- MA戦略のポジション管理が正常に動作するようになった
- 既存のMA戦略ポジションのクローズが可能になった
- MACD戦略は独立した戦略として正しく処理される

## テスト

1. `tests/test_getStrategyKey.js` - 戦略名マッピング関数の単体テスト
2. `tests/test_position_key_mapping.js` - ポジションキーマッピングのシナリオテスト

## 今後の注意点

- 新しい戦略を追加する際は、`config.js` の戦略キーと `getStrategyKey` のマッピングを一致させること
- 表示名（日本語）と内部キー（英語）の対応を明確にドキュメント化すること