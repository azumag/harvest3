# 📡 APIスロットリング設定ガイド

このドキュメントでは、harvest3システムにおけるAPIスロットリング機能の詳細な設定方法と最適化手法について説明します。

## 📊 現在の設定値（2024年7月時点）

### 主要設定ファイル
- **API制限設定**: `src/common/const.js` の `EXCHANGE_SETTINGS`
- **取引設定**: `src/common/const.js` の `TRADING_SETTINGS`
- **注文管理設定**: `src/common/const.js` の `ORDER_MANAGEMENT_SETTINGS`

### EXCHANGE_SETTINGS 詳細

```javascript
// src/common/const.js - EXCHANGE_SETTINGS
const EXCHANGE_SETTINGS = {
  RATE_LIMIT: 8000,                    // 基本レート制限: 8秒間隔（緊急対応値）
  TIMEOUT: 60000,                      // タイムアウト: 60秒
  MAX_THROTTLE_QUEUE_SIZE: 2000,       // 最大キューサイズ: 2000リクエスト
  
  // 段階的バックオフ設定
  BACKOFF_ENABLED: true,               // バックオフ機能: 有効
  BACKOFF_INITIAL_DELAY: 2000,         // 初期遅延: 2秒
  BACKOFF_MAX_DELAY: 60000,            // 最大遅延: 60秒
  BACKOFF_MULTIPLIER: 2,               // 遅延倍数: 2倍
  
  // 並列実行制限
  MAX_CONCURRENT_PAIRS: 2,             // 同時処理ペア数: 2
  EXECUTION_DELAY_MS: 2000,            // 処理間隔: 2秒
  
  // 監視設定
  HEALTH_CHECK_INTERVAL: 60000,        // ヘルスチェック: 1分間隔
  MAX_CONSECUTIVE_FAILURES: 3          // 連続失敗許容数: 3回
};
```

## 🎯 bitbank API制限の詳細

### 公式制限
- **取得系API**: 10回/秒
- **更新系API**: 6回/秒
- **WebSocket**: 接続数制限あり

### 実測データ（2024年7月調査）
- **5秒間隔**: 安定した動作を確認
- **8秒間隔**: throttle queue エラーを確実に回避
- **10秒間隔**: 過度に保守的、パフォーマンス低下

## 🔧 設定値の確認方法

### Step 1: 基本設定の確認
```bash
# 設定ファイルの内容を確認
cat src/common/const.js | grep -A 20 "EXCHANGE_SETTINGS"
```

**期待される出力例**
```javascript
const EXCHANGE_SETTINGS = {
  RATE_LIMIT: 8000,
  TIMEOUT: 60000,
  MAX_THROTTLE_QUEUE_SIZE: 2000,
  // ...
};
```

### Step 2: 実際の適用状況を確認
```bash
# ccxtインスタンスの設定を確認
node -e "
const config = require('./src/config.js');
console.log('rateLimit:', config.exchangeBB.rateLimit);
console.log('timeout:', config.exchangeBB.timeout);
console.log('maxThrottleQueueSize:', config.exchangeBB.options.maxThrottleQueueSize);
console.log('throttle.maxCapacity:', config.exchangeBB.throttle?.maxCapacity);
"
```

**期待される出力例**
```
rateLimit: 8000
timeout: 60000
maxThrottleQueueSize: 2000
throttle.maxCapacity: 2000
```

### Step 3: ランタイム値の確認
```bash
# 実行中のプロセスから設定値を取得
node -e "
const exchange = require('./src/config.js').exchangeBB;
console.log('Current settings:');
console.log('- Rate Limit:', exchange.rateLimit, 'ms');
console.log('- Timeout:', exchange.timeout, 'ms');
console.log('- Max Queue Size:', exchange.throttle?.maxCapacity || 'Not set');
console.log('- Last Request Time:', exchange.last || 'Never');
"
```

## 🚀 パフォーマンス最適化

### 段階的最適化アプローチ

#### Phase 1: 安定性確保（現在）
```javascript
RATE_LIMIT: 8000,              // 保守的な設定
MAX_CONCURRENT_PAIRS: 2,       // 制限的な並列実行
```

#### Phase 2: 段階的緩和（安定性確認後）
```javascript
RATE_LIMIT: 6000,              // 6秒間隔
MAX_CONCURRENT_PAIRS: 3,       // 並列実行増加
```

#### Phase 3: 最適化（実データ分析後）
```javascript
RATE_LIMIT: 5000,              // 5秒間隔（目標値）
MAX_CONCURRENT_PAIRS: 4,       // 更なる並列実行
```

### 動的調整機能

システムは以下の機能により自動的に最適化を図ります：

1. **ThrottleMonitor**: リアルタイムでキュー状況を監視
2. **段階的バックオフ**: エラー発生時の自動遅延増加
3. **連続失敗検知**: 早期の異常検知と回復処理

## 🔍 監視とメトリクス

### 重要な監視項目

```bash
# 1. スロットルキューの使用率
echo "Queue usage: $(node -e 'console.log(require("./src/config.js").exchangeBB.throttle?.queue?.length || 0)')/2000"

# 2. 最後のAPI呼び出しからの経過時間
node -e "
const exchange = require('./src/config.js').exchangeBB;
const elapsed = Date.now() - (exchange.last || 0);
console.log('Time since last API call:', elapsed, 'ms');
"

# 3. エラー率の確認
tail -n 100 logs/app.log | grep -c "throttle\|maxCapacity"
```

### アラート設定

以下の条件でアラートを設定することを推奨：

- **Warning**: キュー使用率 > 80%
- **Critical**: キュー使用率 > 95%
- **Emergency**: throttle queue エラー発生

## 🛠️ トラブルシューティング

### よくある問題と解決法

#### 1. 設定が反映されない
```bash
# ccxtインスタンスの再作成を確認
node -e "
console.log('Before:', require('./src/config.js').exchangeBB.rateLimit);
delete require.cache[require.resolve('./src/config.js')];
console.log('After:', require('./src/config.js').exchangeBB.rateLimit);
"
```

#### 2. 環境変数による上書きが効かない
```bash
# 環境変数の確認
env | grep -E "(RATE_LIMIT|THROTTLE|CONCURRENT)"

# dotenvファイルの確認
cat .env | grep -E "(RATE_LIMIT|THROTTLE|CONCURRENT)"
```

#### 3. Docker環境での設定問題
```bash
# Dockerコンテナ内の設定確認
docker exec harvest3-bot node -e "console.log(process.env.EXCHANGE_RATE_LIMIT)"
```

## 📈 継続的改善

### データ収集と分析

実データ分析システムを活用して以下を継続的に評価：

1. **API応答時間**: 平均・最大・95パーセンタイル
2. **エラー率**: throttle エラーの発生頻度
3. **スループット**: 単位時間あたりの処理量
4. **資源使用率**: CPU・メモリ・ネットワーク

### 最適化のKPI

- **安定性**: throttle エラー率 < 0.1%
- **パフォーマンス**: API応答時間 < 3秒（95%ile）
- **効率性**: 同時処理ペア数 ≥ 3
- **可用性**: システム稼働率 > 99.5%

## 🔗 関連ドキュメント

- [緊急対応・トラブルシューティング](./emergency-troubleshooting.md)
- [システムアーキテクチャ](./architecture.md)
- [リアルデータ分析システム](./real-data-analysis.md)