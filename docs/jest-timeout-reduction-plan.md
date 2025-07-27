# 段階的Jest タイムアウト短縮計画

## 概要

このドキュメントは、CI環境でのタイムアウト値を段階的に最適化し、将来的に適切なタイムアウト値に調整するための包括的な計画を策定します。

## 現状分析（2025年7月時点）

### Jest設定の現状

**jest.config.js**
```javascript
testTimeout: process.env.CI ? 30000 : 60000  // CI: 30秒、ローカル: 60秒
```

**統合されたタイムアウト管理 (jest.setup.js)**
```javascript
global.TEST_TIMEOUTS = {
  DEFAULT: process.env.CI ? 30000 : 60000,
  SCRIPT_EXECUTION: 30000,
  LONG_RUNNING: process.env.CI ? 15000 : 30000,
  BASIC: 10000,
  QUICK: 5000
};
```

### 重要な発見

**Jest タイムアウトは既に最適化済み**
- 現在のCI環境Jest タイムアウト: **30秒**
- Issue記載の180秒→120秒への短縮は完了済み
- 現在の設定は適切でこれ以上の短縮は不推奨

## システム全体のタイムアウト最適化対象

Issue #5387の真の対象は、システム全体のタイムアウト値の最適化と考えられます。

### Phase 1: 現状分析とベースライン策定

#### 1.1 システムレベルタイムアウト調査結果

**長期タイムアウト（180秒）箇所:**
- `src/common/throttleMonitor.js:216` - 容量回復遅延
- `src/common/maintenanceScheduler.js:175` - メンテナンス処理
- `test/unit/common/maintenanceScheduler.test.js:247` - テスト
- `entrypoint.sh:554` - npm install プロセス

**中期タイムアウト（120秒）箇所:**
- `src/common/maintenanceScheduler.js:142,211` - メンテナンス処理
- `test/unit/common/maintenanceScheduler.test.js:232` - テスト
- `entrypoint.sh:395,1350` - npm install プロセス

#### 1.2 適切なタイムアウト値の算出

**推奨最適化方針:**
1. **Jest タイムアウト**: 現状維持（30秒/60秒）
2. **System Process**: 180秒 → 120秒 → 90秒
3. **Maintenance**: 120秒 → 90秒 → 60秒
4. **npm install**: 現状維持（必要に応じて）

### Phase 2: 段階的短縮計画

#### 2.1 Month 1: システムプロセス最適化

**対象ファイル: `src/common/throttleMonitor.js`**
- 現在: 180秒 → 目標: 120秒
- MAX_CAPACITY_RECOVERY_DELAY 短縮
- 安全性確認期間: 2週間

**対象ファイル: `src/common/maintenanceScheduler.js`**
- 長期処理: 180秒 → 120秒
- 中期処理: 120秒 → 90秒
- 段階的実装とモニタリング

#### 2.2 Month 2: 最終最適化

**throttleMonitor 最終調整:**
- 120秒 → 90秒
- 実績データに基づく微調整

**maintenanceScheduler 最終調整:**
- 90秒 → 60秒（安全域考慮）
- 継続監視体制確立

#### 2.3 Month 3: 監視体制確立

**タイムアウト監視システム構築**
- システム全体のタイムアウト統計収集
- アラート機能実装
- 定期レビュープロセス確立

### Phase 3: 監視体制構築

#### 3.1 テスト実行時間の継続監視システム

**monitoring/timeout-monitor.js の実装:**
- Jest実行時間統計
- システムプロセス実行時間監視
- 95パーセンタイル測定

#### 3.2 タイムアウト間近の警告システム

**早期警告機能:**
- タイムアウト閾値の80%到達時警告
- Slack/Discord通知連携
- 自動的なタイムアウト調整提案

#### 3.3 定期的なタイムアウト値見直しプロセス

**月次レビュープロセス:**
- 実行時間統計分析
- タイムアウト値適正性評価
- 必要に応じた調整実施

## 実装マイルストーン

### Month 1: システムプロセス最適化（完了予定: 2025年8月）
- [ ] throttleMonitor.js タイムアウト短縮（180秒→120秒）
- [ ] maintenanceScheduler.js タイムアウト短縮（120秒→90秒）
- [ ] 関連テストの調整
- [ ] 安定性確認期間（2週間）

### Month 2: 最終最適化（完了予定: 2025年9月）
- [ ] throttleMonitor.js 最終調整（120秒→90秒）
- [ ] maintenanceScheduler.js 最終調整（90秒→60秒）
- [ ] 実績データ分析と微調整
- [ ] 包括的な安定性テスト

### Month 3: 監視体制確立（完了予定: 2025年10月）
- [ ] timeout-monitor.js システム実装
- [ ] 早期警告システム構築
- [ ] 定期レビュープロセス文書化
- [ ] 運用開始

## 成功基準

### 技術的指標
- システム安定性を維持しながらタイムアウト短縮達成
- テストハング問題の継続的な防止
- 95パーセンタイル実行時間 + 安全マージン以内でのタイムアウト設定

### 運用指標
- タイムアウト関連障害0件
- システム全体のレスポンス向上
- 適切な監視体制の確立

## 関連リソース

### 依存関係
- Issue #5386: 遅いテストケース最適化完了後の実施
- PR #5384: 現在のタイムアウト延長施策の知見活用
- Issue #5383: 原始的なタイムアウト問題の教訓

### 設定ファイル
- `jest.config.js`: Jest タイムアウト設定（最適化済み）
- `jest.setup.js`: 統合タイムアウト管理
- `src/common/throttleMonitor.js`: システム処理タイムアウト
- `src/common/maintenanceScheduler.js`: メンテナンス処理タイムアウト

### 監視ツール
- `scripts/timeout-monitor.js`: システム全体監視（新規作成予定）
- CI/CD pipeline: 継続的な実行時間監視
- GitHub Actions: タイムアウト統計収集

## 注意事項

1. **Jest タイムアウトは変更不要**: 現在の30秒/60秒設定は適切
2. **段階的実装**: 一度に全て変更せず、段階的にリスク管理
3. **継続監視**: 変更後は必ず監視期間を設けて安定性確認
4. **ロールバック計画**: 問題発生時の迅速な復旧手順を準備

---

*このドキュメントは Issue #5387 に基づいて作成され、システム全体のタイムアウト最適化を目的としています。*