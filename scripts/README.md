# スクリプト一覧

このディレクトリには、システムの整合性チェックやメンテナンス用のスクリプトが格納されています。

## Redisポジション自動クリーンアップツール

### ポジション履歴クリーンアップ（推奨）

**ファイル**: `cleanupOldPositions.js`  
**コマンド**: `node scripts/cleanupOldPositions.js [時間] [オプション]`

古い完了ポジションをRedisから削除し、MongoDBに履歴として保存します。Redis のメモリ使用量を最適化し、システムパフォーマンスを向上させます。

**機能**:
- 指定期間より古い完了ポジションの自動削除
- 削除前にMongoDBへの履歴保存
- Dry-runモードによる安全な確認
- Discord通知による実行結果の報告

**使用例**:
```bash
# 24時間より古いポジションを削除（デフォルト）
node scripts/cleanupOldPositions.js

# 48時間より古いポジションを削除
node scripts/cleanupOldPositions.js 48

# 削除対象を確認のみ（実際には削除しない）
node scripts/cleanupOldPositions.js --dry-run

# 12時間で履歴保存なし
node scripts/cleanupOldPositions.js 12 --no-history

# ヘルプを表示
node scripts/cleanupOldPositions.js --help
```

**推奨実行タイミング**:
- 毎日の定期実行（cron等で自動化）
- システムメンテナンス時
- Redis メモリ使用量が高い時

## 残高・ポジション整合性チェックツール

### 1. ポジション整合性チェック（推奨）

**ファイル**: `checkPositionConsistency.js`  
**コマンド**: `npm run check-position-consistency`

各戦略のnetPositionを銘柄（通貨）ごとに合算し、取引所の実際の保有量（free + used）と比較します。

**機能**:
- Redis上の全戦略のnetPositionを通貨別に集計
- 取引所の実際の保有量（free + used）を取得
- 両者を比較して不整合を検出
- 詳細な不整合レポートを出力

### 1.5. ポジション不整合修正ツール

**ファイル**: `fixPositionInconsistencies.js`  
**コマンド**: `npm run fix-position-inconsistencies`

ポジション整合性チェックで検出された不整合を分析し、安全な修正提案を行います。

**機能**:
- 不整合の重要度を分析（高/中/低）
- 0ポジション戦略記録の削除提案
- インタラクティブな修正実行
- ドライランモードでの安全な確認

**出力例**:
```
🔍 ポジション整合性チェック結果
================================================================================

📊 サマリー:
   総チェック項目数: 15
   ✅ 整合性あり: 12 (80.0%)
   ❌ 不整合: 2 (13.3%)
   🔶 Redisのみ: 1
   🔷 取引所のみ: 0

❌ 不整合が検出された通貨:
--------------------------------------------------------------------------------

🏦 bitbank - BTC:
   取引所保有量: 0.02500000 (Free: 0.01000000, Used: 0.01500000)
   Redis合計: 0.02300000
   差分: 0.00200000 (8.00%)
   戦略内訳:
     BTC/JPY [MEAN_REVERSION]: 0.01500000
     BTC/JPY [MUTUAL_INFO]: 0.00800000
```

### 2. 従来の残高整合性チェック

**ファイル**: `balanceConsistencyChecker.js`  
**コマンド**: `npm run check-balance`

通貨別にRedisのポジション記録と取引所残高を比較します。

### 3. 取引所vs取引サマリー比較

**ファイル**: `compareExchangeVsSummary.js`  
**コマンド**: `npm run compare-balance`

取引所残高とgetTradeSummaryのnetPositionを比較します。

## 使用方法

### Docker環境内での実行

```bash
# Dockerコンテナ内でポジション整合性をチェック
docker exec strategy-runner npm run check-position-consistency

# 従来の残高チェック
docker exec strategy-runner npm run check-balance

# 取引所vs取引サマリー比較
docker exec strategy-runner npm run compare-balance
```

### ローカル環境での実行

```bash
# ポジション整合性チェック
npm run check-position-consistency

# 従来の残高チェック
npm run check-balance

# 取引所vs取引サマリー比較
npm run compare-balance
```

## 推奨される使用タイミング

1. **定期的なヘルスチェック**: 1日1回程度
2. **戦略停止後**: ポジションクリア確認のため
3. **取引異常検知時**: 不整合の原因調査のため
4. **システム再起動後**: データ整合性確認のため

## 注意事項

- スクリプト実行時は取引所APIを使用するため、API制限にご注意ください
- 不整合が検出された場合は、手動での調整が必要な場合があります
- Redis上のポジションデータは戦略ごとに管理されているため、手動削除時は慎重に行ってください

## トラブルシューティング

### 不整合が検出された場合

1. **ゾンビポジション（Redisのみ）**: 
   - Redis上にポジション記録があるが、実際の残高は0
   - 手動でRedisレコードを削除することを検討

2. **差分がある場合**:
   - 取引が進行中の可能性
   - しばらく待ってから再度チェック
   - 手動取引や外部取引の影響を確認

3. **取引所のみに存在**:
   - 手動取引や外部取引による残高
   - 必要に応じてRedisに記録を追加