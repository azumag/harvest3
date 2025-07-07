# 緊急対応マニュアル

## 概要
このマニュアルは、harvest3システムの緊急事態に迅速かつ体系的に対応するための手順書です。

## 重要度分類

### 🚨 Critical (緊急)
- システム停止、データ損失、API制限超過
- 即座に対応が必要
- 対応時間: 5分以内

### ⚠️ High (高)
- パフォーマンス低下、エラー率上昇
- 1時間以内の対応が必要
- 対応時間: 1時間以内

### ⚡ Medium (中)
- 軽微な機能不全、警告レベルの問題
- 対応時間: 4時間以内

## 緊急対応フロー

### 1. 問題の特定
```bash
# システム状態の確認
npm run health-check

# エラーログの確認
tail -f logs/error.log

# パフォーマンス監視
htop
```

### 2. 緊急停止
```bash
# 全戦略の停止
node scripts/kill.js

# システムの緊急停止
pm2 stop all
```

### 3. 状況の記録
- 発生時刻
- 症状
- 影響範囲
- 対応者

### 4. 復旧手順
1. 問題の根本原因を特定
2. 修正を適用
3. テスト環境で動作確認
4. 段階的な本番復旧

## 一般的な障害パターン

### API制限超過
```bash
# 症状: 429エラー、throttle警告
# 対応: 独自throttle設定の調整
node scripts/analyzePendingOrders.js
```

### データベース接続エラー
```bash
# 症状: MongoDB/Redis接続失敗
# 対応: 接続設定の確認と再起動
docker-compose restart mongodb redis
```

### 残高不整合
```bash
# 症状: 取引所残高とシステム残高の差異
# 対応: 残高チェッカーの実行
node scripts/balanceConsistencyChecker.js
```

### メモリ不足
```bash
# 症状: OOM エラー、システム遅延
# 対応: プロセスの再起動とメモリ監視
pm2 restart all
```

## 連絡体制

### 緊急時通知
- Discord通知の確認
- ログ監視システムの確認
- 必要に応じて手動通知

### エスカレーション
1. 自動復旧の試行
2. 手動対応の実行
3. 必要に応じて外部専門家への相談

## 予防策

### 定期メンテナンス
```bash
# 週次実行
node scripts/preventiveQualitySystem.js

# 月次実行
node scripts/comprehensiveImprovementPlan.js
```

### 監視設定
- DeadMan's Switch の確認
- システムモニターの状態確認
- アラート設定の見直し

## 復旧後の対応

### 1. 事後分析
- 原因の詳細分析
- 対応時間の記録
- 改善点の抽出

### 2. 文書化
- 障害レポートの作成
- 対応手順の更新
- 知識ベースの更新

### 3. 再発防止
- 予防策の実装
- 監視設定の強化
- 手順の改善

## 重要なスクリプト

### 緊急対応用
- `scripts/kill.js` - システム緊急停止
- `scripts/emergencyBalanceRepair.js` - 残高修復
- `scripts/emergencyRiskLimits.js` - リスク制限設定

### 診断用
- `scripts/criticalFailureAnalysis.js` - 障害分析
- `scripts/quickPositionAnalysis.js` - ポジション分析
- `scripts/rootCauseAnalysis.js` - 根本原因分析

### 復旧用
- `scripts/finalCheck.js` - 最終確認
- `scripts/startBasicAnomalyDetector.js` - 異常検知開始

## 注意事項

1. 緊急時は冷静な判断を優先
2. 手順に従って系統的に対応
3. 必要に応じて保守的な選択を採用
4. 全ての対応を記録に残す
5. 復旧後は必ず事後分析を実施

## 更新履歴

- 2025-07-07: 初版作成