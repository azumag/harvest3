# スケジューリング改善提案

## 現状の問題

現在の実装では`setTimeout`と`setInterval`を組み合わせて毎時0分の実行を実現していますが、以下の課題があります：

1. **複雑性**: 初回実行タイミングの計算が複雑
2. **可読性**: 時間計算ロジックが直感的でない  
3. **拡張性**: 複数の異なるスケジュールに対応しにくい
4. **保守性**: スケジュール変更時の影響範囲が大きい

## 提案解決策

### 1. 専用cronライブラリの導入

**推奨ライブラリ: `node-cron`**

```bash
npm install node-cron
```

**メリット:**
- 宣言的なcron式によるスケジュール定義
- タイムゾーン対応
- 動的なスケジュール変更
- エラーハンドリングの統一

### 2. 実装例

```javascript
const cron = require('node-cron');

// 毎時0分に実行
cron.schedule('0 * * * *', () => {
  executeRobustBalanceCheck().catch(error => {
    console.error('堅牢残高チェック実行エラー:', error.message);
  });
}, {
  timezone: "Asia/Tokyo"
});

// 5分ごとに軽量チェック
cron.schedule('*/5 * * * *', () => {
  executeLightweightBalanceCheck().catch(error => {
    console.error('軽量残高チェック実行エラー:', error.message);
  });
});
```

### 3. 設定による柔軟なスケジューリング

```javascript
// balanceCheckerConfig.js
const BALANCE_CHECKER_CONFIG = {
  schedules: {
    robustCheck: '0 * * * *',      // 毎時0分
    lightweightCheck: '*/5 * * * *', // 5分ごと
    dailyReport: '0 9 * * *',      // 毎日9時
    weeklyReport: '0 9 * * 1'      // 毎週月曜9時
  }
};

// scheduler.js
const { schedules } = require('./balanceCheckerConfig');

Object.entries(schedules).forEach(([taskName, cronExpression]) => {
  cron.schedule(cronExpression, () => {
    executeTask(taskName);
  });
});
```

### 4. 移行計画

**Phase 1: 現在の実装の整理**
- 現在のスケジューリング関数を独立したモジュールに分離
- 設定による時間間隔の外部化

**Phase 2: cronライブラリの導入**
- `node-cron`の追加
- 既存スケジュールのcron式への変換
- テストケースの更新

**Phase 3: 拡張機能の実装**
- 動的スケジュール変更機能
- スケジュール状態の監視
- エラー時の自動復旧

### 5. 期待効果

1. **可読性向上**: cron式による直感的なスケジュール定義
2. **保守性向上**: 設定変更だけでスケジュール調整可能
3. **拡張性向上**: 新しいスケジュールタスクの追加が容易
4. **信頼性向上**: 専用ライブラリによる堅牢な時間管理

### 6. リスク評価

**低リスク:**
- `node-cron`は軽量で安定したライブラリ
- 既存機能への影響なし
- 段階的移行が可能

**対策:**
- 十分なテストケースの作成
- フォールバック機能の実装
- 移行期間中の監視強化

## 実装推奨時期

現在のシステムが安定稼働しているため、次回のメンテナンス期間で実装することを推奨します。