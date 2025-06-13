# リスク管理機能

## 概要

harvest3にリスク管理機能が実装されました。この機能により、大きな損失を防ぎ、より安定した収益を実現できます。

## 主な機能

### 1. ストップロス機能

#### 固定ストップロス
- エントリー価格から-2%で自動的に損切り
- すべてのポジションに適用

#### トレーリングストップ
- 利益が+1%を超えると発動
- 最高値から-1%で追従
- 利益を確保しながらリスクを制限

#### 時間ベースストップ
- 24時間以上保持したポジションは自動決済
- 長期間の塩漬けを防止

### 2. 最大ドローダウン制御

#### 日次制限
- 1日の最大損失: -5%
- 制限に達すると当日の新規取引を停止

#### 週次制限
- 1週間の最大損失: -10%
- 制限に達すると戦略を一時停止

#### 月次制限
- 1ヶ月の最大損失: -15%
- 制限に達すると戦略の見直しアラート

### 3. ポジション管理

- 同一通貨ペアの最大ポジション数: 3
- 全体の最大同時ポジション数: 10
- リスク分散を自動的に実現

## 設定方法

### 戦略パラメータでの有効化

リスク管理を有効にするには、戦略パラメータに以下を追加します：

```javascript
{
  "enabled": true,
  "period": 20,
  "ohlcvInterval": "1h",
  "tradePercentage": 0.1,
  // リスク管理を有効化
  "enableRiskManagement": true,
  // リスク設定をカスタマイズ（オプション）
  "riskSettings": {
    "fixedStopLossPercent": 0.02,      // 2%の固定ストップロス
    "trailingStopTriggerPercent": 0.01, // 1%の利益でトレーリング発動
    "trailingStopDistancePercent": 0.01,// 最高値から1%でトレーリング
    "timeBasedStopHours": 24,           // 24時間でタイムストップ
    "dailyMaxLossPercent": 0.05,        // 日次最大損失5%
    "weeklyMaxLossPercent": 0.10,       // 週次最大損失10%
    "monthlyMaxLossPercent": 0.15,      // 月次最大損失15%
    "maxPositionsPerPair": 3,           // 同一ペアの最大ポジション
    "maxTotalPositions": 10,            // 全体の最大ポジション
    "initialCapital": 100000            // 初期資金（ドローダウン計算用）
  }
}
```

### デフォルト設定

`enableRiskManagement: true`を設定するだけで、デフォルトのリスク設定が適用されます：

```javascript
{
  "enableRiskManagement": true
}
```

## APIでの設定更新

### パラメータ更新エンドポイント

```bash
# リスク管理を有効化
curl -X POST http://localhost:3001/api/parameters \
  -H "Content-Type: application/json" \
  -d '{
    "exchangeId": "bitbank",
    "symbol": "BTC/JPY",
    "strategyKey": "meanReversion",
    "params": {
      "enabled": true,
      "period": 20,
      "ohlcvInterval": "1h",
      "tradePercentage": 0.1,
      "enableRiskManagement": true
    }
  }'
```

### 現在の設定確認

```bash
curl "http://localhost:3001/api/parameters?exchangeId=bitbank&symbol=BTC%2FJPY&strategyKey=meanReversion"
```

## 動作確認

### ログでの確認

リスク管理が動作すると、以下のようなログが出力されます：

```
[リスク管理] ストップロス実行: bitbank - BTC/JPY
理由: 価格到達
エントリー価格: 5,000,000
決済価格: 4,900,000
損益: -2.00%
```

```
[meanReversion] ポジション制限: bitbank - BTC/JPY - 同一通貨ペアの最大ポジション数(3)に達しています
```

```
meanReversion: 日次最大損失に達したため新規取引を停止します
```

### Discord通知

リスク管理のアクションはDiscordにも通知されます（設定されている場合）。

## 注意事項

1. **バックテストモード**: リスク管理機能はリアルタイムモードでのみ動作します
2. **パフォーマンス**: リスク管理チェックにより、わずかに処理時間が増加します
3. **ポジション追跡**: 現在はメモリ内でポジションを追跡しています（将来的にRedisへ移行予定）

## トラブルシューティング

### リスク管理が動作しない

1. `enableRiskManagement: true`が設定されているか確認
2. 戦略が有効（`enabled: true`）になっているか確認
3. ログでエラーメッセージを確認

### ストップロスが実行されない

1. 現在価格がストップロス価格を下回っているか確認
2. ポジションが正しく記録されているか確認
3. 24時間経過していないか確認（時間ベースストップ）

## 今後の改善予定

- [ ] ポジションストレージのRedis移行
- [ ] より詳細なリスクレポート機能
- [ ] 戦略ごとのリスク統計
- [ ] リスク管理ダッシュボード