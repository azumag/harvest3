# ポジションクローズ失敗エラー詳細調査レポート

**調査日時**: 2025-06-29  
**対象**: bitbank:SAND/JPY, OAS/JPY, GRT/JPY でのポジションクローズ失敗  
**約定ID**: 1413127994, 1413128002, 1413127906, 1413127908, 1413127860  
**戦略**: オシレーター戦略、BB戦略、MA戦略、マルチ指標戦略

## 1. 根本原因の特定

### 主要な問題
`/Users/azumag/work/harvest3/src/database/manager.js:763` で発見されたエラーメッセージ：
```javascript
throw new Error(closeResult.message || 'ポジションクローズ失敗');
```

### 根本原因分析（emergency_fix_position_close.js より）
1. **MongoDB接続エラー**: Docker ネットワーク外での実行時にMongoDB接続が失敗
2. **成功フラグの誤判定**: `closeAndCleanupPosition`関数がRedisからの削除に成功してもMongoDB保存失敗により`{ success: false }`を返す
3. **リトライループ**: 3回のリトライが全て失敗するが、実際にはポジションは削除されている

## 2. 関連ファイルとエラーハンドリング

### ポジションクローズ処理の流れ
1. **エントリーポイント**: `/Users/azumag/work/harvest3/src/database/manager.js:751-785`
2. **実際の処理**: `/Users/azumag/work/harvest3/src/database/redisDatabase.js:796-858` (`closeAndCleanupPosition`)
3. **Redis操作**: 
   - `getPositionRedis` (line 583-609): ポジション情報取得
   - `deletePositionRedis` (line 701-710): ポジション削除
4. **MongoDB履歴保存**: `savePositionHistoryToMongoDB` (line 717+)

### エラーハンドリング機能
- **リトライ機構**: 最大3回の再試行（100ms間隔）
- **Discord通知**: 3回失敗時に重要エラー通知
- **ログ出力**: ワーニングレベルでの失敗ログ

## 3. ポジション管理・データベース処理

### Redis処理
```javascript
// ポジション取得
async function getPositionRedis(positionKey) {
  const key = `position:${positionKey}`;
  const position = await client.hGetAll(key);
  return Object.keys(position).length === 0 ? null : position;
}

// ポジション削除
async function deletePositionRedis(positionKey) {
  const key = `position:${positionKey}`;
  const result = await client.del(key);
  return result > 0;
}
```

### MongoDB履歴保存の問題
- Docker外実行時のMongoDB接続エラー
- 接続失敗でも処理は継続するが、成功フラグが`false`になる

## 4. bitbank API連携処理

### HFTシステム関連ファイル
- **Private Stream**: `/Users/azumag/work/harvest3/src/hft/bitbank/PrivateStreamClient.js`
  - WebSocket認証処理（未実装部分あり）
  - 注文・ポジション通知処理（TODO状態）
- **Public Stream**: `/Users/azumag/work/harvest3/src/hft/bitbank/PublicStreamClient.js`
- **WebSocket基盤**: `/Users/azumag/work/harvest3/src/hft/bitbank/WebSocketClient.js`

### API連携の課題
- プライベートストリーム認証機能が未完成
- 注文約定通知の処理ロジックが未実装
- リアルタイムポジション更新機能が不完全

## 5. 戦略別エラーハンドリング

### 対象戦略の実装場所
- **オシレーター戦略**: `/Users/azumag/work/harvest3/src/strategies/meanReversion.js`
- **BB戦略・MA戦略・マルチ指標戦略**: `/Users/azumag/work/harvest3/src/strategies/trendFollowing.js`

### 戦略レベルのエラーハンドリング
```javascript
// 共通のエラーハンドリングパターン
try {
  // 戦略実行
} catch (error) {
  console.error(`戦略でエラーが発生しました: ${symbol}`, error);
  await postErrorToDiscord(`[戦略名] エラー: ${exchange.id} - ${symbol} - ${error.message}`);
}
```

## 6. ログ分析結果

### 現在のログ状況
- **Redis接続エラー**: `getaddrinfo ENOTFOUND redis` が頻発
- **ポジションクローズエラー**: 指定された約定IDのログエントリは未発見
- **Docker外実行の影響**: Redis/MongoDB接続問題が根本原因

### ログファイル
- 主要ログ: `/Users/azumag/work/harvest3/api.log`
- その他の関連ログファイル複数存在

## 7. 緊急対応策（実装済み）

### Emergency Fix Script
`/Users/azumag/work/harvest3/emergency_fix_position_close.js` が既に存在：
- Redis削除を優先し、MongoDB保存失敗を許容
- 成功時には `{ success: true }` を返すよう修正
- 手動でのポジションクリーンアップ機能

## 8. 推奨対応策

### 短期対応
1. **closeAndCleanupPosition関数の修正**
   - MongoDB保存失敗時でもRedis削除成功なら`success: true`を返す
   - 現在のemergency fixの永続化

### 中期対応
1. **Docker環境での実行**
   - Redis/MongoDB接続問題の根本解決
2. **bitbank API連携の完成**
   - プライベートストリーム認証実装
   - リアルタイムポジション更新機能

### 長期対応
1. **監視システムの強化**
   - ポジション状態の継続監視
   - 自動復旧機能の実装
2. **テスト環境の整備**
   - Docker外でのテスト実行環境

## 9. 結論

**根本原因**: Docker環境外でのMongoDB接続失敗により、ポジションクローズ処理が成功しているにも関わらず失敗フラグが返される

**影響範囲**: 全戦略のポジションクローズ処理

**緊急度**: 高 - 取引継続に直接影響

**対応状況**: 緊急対応スクリプトは既に実装済み、本格修正が必要