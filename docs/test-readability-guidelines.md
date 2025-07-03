# テストコード可読性向上ガイドライン

Geminiレビュー対応：テストの可読性と保守性向上

## 改善された点

### 1. テスト名の簡潔化

**Before (改善前):**
```javascript
it('取引所API接続失敗時の適切なエラーハンドリング', async () => {
it('MongoDB取引履歴が破損している場合のエラーハンドリング', async () => {
it('Redis接続失敗時の堅牢な比較エラーハンドリング', async () => {
```

**After (改善後):**
```javascript
it('handles API timeout', async () => {
it('recovers from MongoDB errors', async () => {
it('handles Redis connection failure', async () => {
```

**改善理由:**
- 簡潔で理解しやすい
- 英語で統一（国際化対応）
- 重要な動作に焦点を当てた命名

### 2. ヘルパー関数の導入

**Before (改善前):**
```javascript
// 同じようなmock設定が各テストで重複
config.exchanges.bitbank.instance.fetchBalance.mockResolvedValue({
  total: { BTC: 1.5, ETH: 10.0, GRT: 0.2626 },
  free: { BTC: 1.0, ETH: 8.0, GRT: 0.2626 },
  used: { BTC: 0.5, ETH: 2.0, GRT: 0.0 }
});
```

**After (改善後):**
```javascript
// 再利用可能なヘルパー関数
testHelpers.mockExchangeBalance(testHelpers.sampleBalance);
```

### 3. アサーションの簡素化

**Before (改善前):**
```javascript
expect(result.mongodb).toBeDefined();
expect(result.redisSummary).toBeDefined();
expect(result.redisPositions).toBeDefined();
expect(result.mongodb.BTC).toBe(1.5);
expect(result.redisSummary.BTC).toBe(1.2);
expect(result.redisPositions.BTC).toBe(1.3);
```

**After (改善後):**
```javascript
testHelpers.expectBalanceMatch(result.mongodb, { BTC: 1.5 });
```

### 4. テスト構造の整理

**Before (改善前):**
```javascript
describe('エラーケースのテスト', () => {
  describe('ネットワークエラー処理', () => {
    describe('データ不整合エラー', () => {
      // 深い入れ子構造
```

**After (改善後):**
```javascript
describe('Error Handling', () => {
  describe('Network Errors', () => {
  describe('Data Corruption', () => {
    // フラットで理解しやすい構造
```

## ベストプラクティス

### 1. DRY原則の適用

重複するモック設定やアサーションはヘルパー関数に抽出:

```javascript
const testHelpers = {
  mockExchangeBalance: (balance) => { /* ... */ },
  mockRedisClient: (responses = {}) => { /* ... */ },
  expectBalanceMatch: (result, expected) => { /* ... */ }
};
```

### 2. データの一元管理

テストデータは定数として定義:

```javascript
const testHelpers = {
  sampleBalance: { total: { BTC: 1.5, ETH: 10.0 } },
  samplePosition: { exchange: 'bitbank', symbol: 'BTC/JPY' }
};
```

### 3. シナリオベースのテスト

複雑なテストケースはシナリオ関数でセットアップ:

```javascript
const setupBalancedScenario = () => {
  testHelpers.mockExchangeBalance(testHelpers.sampleBalance);
  getAllPositionsRedis.mockResolvedValue([testHelpers.samplePosition]);
};
```

### 4. 明確なテスト意図

各テストは1つの明確な責任を持つ:

```javascript
it('detects discrepancies', async () => {
  // Setup: create imbalanced scenario
  // Action: run comparison
  // Assert: verify discrepancy detection
});
```

## 実装推奨事項

### 1. 段階的な改善

既存のテストファイルを一度に全て書き換えるのではなく:
1. 最も複雑なテストファイルから開始
2. ヘルパー関数を先に作成
3. 既存テストを徐々に移行

### 2. チーム標準の確立

```javascript
// プロジェクト共通のテストヘルパー
// test/helpers/common.js
module.exports = {
  mockHelpers: { /* ... */ },
  testData: { /* ... */ },
  assertions: { /* ... */ }
};
```

### 3. 継続的な改善

- 新しいテスト追加時は改善されたパターンを使用
- コードレビューでテスト品質もチェック
- 定期的なテストコードのリファクタリング

## 期待効果

1. **保守性向上**: テスト修正時の影響範囲を最小化
2. **可読性向上**: 新しいメンバーでも理解しやすい
3. **開発効率向上**: テスト作成時間の短縮
4. **品質向上**: より多くのエッジケースをテスト可能

この改善により、テストコードも本体コードと同様に高品質で保守可能な資産となります。