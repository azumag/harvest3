# 暗号通貨取引ボット (harvest3)

このプロジェクトは、複数の取引戦略を実装した暗号通貨取引ボット (`harvest3`) です。ccxtライブラリを使用して、複数の取引所（bitbank、bitflyer）に接続し、自動取引を行います。**Redis**データベースを使用してリアルタイムな取引記録、ポジション、イベントなどを管理し、**MongoDB**データベースを使用して注文、約定、シグナルなどの履歴データを永続化します。Web UIを通じてリアルタイムな状態監視や履歴確認が可能です。

## 🚀 クイックスタート

### 5分で始める最小セットアップ

1. **リポジトリのクローン**
   ```bash
   git clone <リポジトリURL>
   cd harvest3
   ```

2. **設定ファイルの作成**
   ```bash
   cp .env.example .env
   # .envファイルを編集してAPIキーを設定
   ```

3. **Docker環境での実行**
   ```bash
   docker compose up -d
   ```

4. **動作確認**
   ```bash
   # Web UIにアクセス
   open http://localhost:3000
   
   # ログ確認
   docker compose logs -f bot
   ```

### 問題が発生した場合

よくある問題とその対処法については、[🚨 緊急対応・トラブルシューティング](#-緊急対応トラブルシューティング)を参照してください。

## 📋 基本情報

### 主な機能

- **複数の取引戦略を並行して実行可能**
- **複数の取引所 (Bitbank, Bitflyer) に対応**
- **環境変数による柔軟な設定変更**
- **Discordへの通知機能** (エラー、注文、損益レポート)
- **Redis** および **MongoDB** データベースによるデータ永続化と管理
- **Web UIによるリアルタイム監視と履歴表示**
- **Dockerによる簡単なデプロイと実行**
- **MarketDataProvider** による中央集約化されたティッカーデータ取得とキャッシュ
- **包括的なAPIスロットリング** による取引所API制限対応
- **イベント駆動アーキテクチャ** による効率的なデータ処理
- **実データ収集・分析システム** による理論値から実証値への移行と最適化
- **リアルタイム監視システム** による自動的な閾値調整と異常検知

### 実装されている戦略

`src/config.js` または環境変数 (`STRATEGY_*_ENABLED=true/false`) で各戦略の有効/無効を切り替えられます。

#### トレンドフォロー戦略 (`strategies/trendFollowing.js`, `strategies/indicators.js`)

- **移動平均線クロス (MA)**: 短期と長期の移動平均線が交差する点を売買シグナルとします。
- **MACD (Moving Average Convergence Divergence)**: 2つの移動平均線の差と、その移動平均線を利用してトレンドの方向性や勢いを判断します。
- **RSI (Relative Strength Index)**: 買われすぎや売られすぎの水準を判断し、反転を狙います。
- **ボリンジャーバンド (BOLLINGER_BANDS)**: 価格の変動幅を統計的に捉え、上限や下限に達した際に逆張りをする戦略や、バンド幅の拡大でトレンドの発生を予測します。

#### 逆張り戦略 (`strategies/meanReversion.js`, `strategies/indicators.js`)

- **平均回帰 (MEAN_REVERSION)**: 価格は長期的には平均値に戻るという考えに基づき、大きく乖離した際に逆張りをする戦略です。
- **オシレーター (OSCILLATOR)**: RSIやストキャスティクスなどのオシレーター系指標が買われすぎや売られすぎの水準を示す際に、反転を狙います。

#### アービトラージ戦略 (`strategies/arbitrage.js`)

- **取引所間アービトラージ (INTER_EXCHANGE_ARBITRAGE)**: 複数の取引所間でビットコインの価格差が生じた際に、安い取引所で買って高い取引所で売ることで利益を得ます。

## ⚙️ セットアップ

### 前提条件

- Node.js (v16以上推奨)
- npm
- Docker および Docker Compose (Dockerで実行する場合)
- BitbankとBitflyerのAPIキー
- Discord Webhook URL (通知機能を利用する場合)
- **Redis サーバー**
- **MongoDB サーバー**

### 主な依存関係

- `ccxt` - 取引所API接続
- `redis` - Redisクライアント
- `mongodb` - MongoDBクライアント
- `lru-cache` - MarketDataProviderのキャッシュ機能
- `axios` - HTTP通信
- `jest` - テストフレームワーク

### インストール

1. **依存関係をインストール**
   ```bash
   npm install
   ```

2. **環境変数の設定**
   `.env.example`ファイルを`.env`にコピーし、必要な情報を入力します。
   ```bash
   cp .env.example .env
   ```

3. **環境設定の編集**
   ```dotenv
   # 取引所APIキー
   BB_API_KEY=your_bitbank_api_key
   BB_API_SECRET=your_bitbank_api_secret
   BF_API_KEY=your_bitflyer_api_key
   BF_API_SECRET=your_bitflyer_api_secret

   # Discord通知用Webhook URL (任意)
   DISCORD_ERROR_WEBHOOK_URL=your_discord_webhook_url_for_errors
   DISCORD_ORDER_WEBHOOK_URL=your_discord_webhook_url_for_orders
   DISCORD_RESULT_WEBHOOK_URL=your_discord_webhook_url_for_results

   # Redis接続URL (Docker Composeを使用しない場合)
   REDIS_URL=redis://localhost:6379

   # MongoDB接続設定 (Docker Composeを使用しない場合)
   MONGO_URL=mongodb://localhost:27017
   MONGO_DB_NAME=harvest3
   ```

   **注意:** `.env` ファイルに機密情報（APIキーなど）を記述するため、このファイルをGitリポジトリにコミットしないでください (`.gitignore` に含まれていることを確認してください)。

## 🎯 実行方法

### 通常実行

- **標準ボット (bot.js):** 設定ファイル (`src/config.js`) で有効になっている戦略を実行します。
  ```bash
  npm start
  ```

- **Web UIサーバー (src/api/index.js):** Web UI用のAPIサーバーを起動します。
  ```bash
  npm run start-web
  ```

- **残高整合性チェック:** Redis管理残高と実際の取引所残高の整合性をチェックします。
  ```bash
  npm run check-balance
  ```

### Dockerでの実行

`docker-compose.yml` を使用して、各サービスをコンテナとして実行できます。

- **すべてのサービスを起動:**
  ```bash
  docker compose up -d
  ```

- **特定のサービスのみを起動:**
  ```bash
  # 標準ボットのみ起動
  docker compose up -d bot

  # Web UIのみ起動
  docker compose up -d web-ui

  # データベースのみ起動
  docker compose up -d redis mongo
  ```

- **ログの確認:**
  ```bash
  docker compose logs -f bot
  ```

- **停止:**
  ```bash
  docker compose down
  ```

## 🚨 緊急対応・トラブルシューティング

> **緊急事態対応**: 詳細な対処法は [📋 緊急対応ガイド](./docs/emergency-troubleshooting.md) を参照してください。

### 🔥 最頻発エラーの即座対処法

#### `throttle queue is over maxCapacity` エラー
```bash
# 🚑 緊急停止・再開（30秒）
pkill -f "node.*bot" && export EXCHANGE_RATE_LIMIT=15000 && npm start
```

#### MongoDB E11000 重複エラー
```bash
# 🔧 重複データ削除
mongo harvest3 --eval "db.collection.deleteOne({'duplicateField': 'value'})"
```

#### システムのヘルスチェック
```bash
# 現在の状態確認
docker compose ps

# エラーログの確認
docker compose logs --tail=100 bot | grep -i error

# リソース使用状況確認
docker stats --no-stream
```

### 📋 よくある問題と対処法

| 問題 | 対処法 |
|------|-------|
| APIキーエラー | `.env`ファイルのAPIキー設定を確認 |
| Redis接続エラー | `docker compose up -d redis` でRedisを起動 |
| MongoDB接続エラー | `docker compose up -d mongo` でMongoDBを起動 |
| ポート使用エラー | `docker compose down` で既存コンテナを停止 |

## 📊 監視とレポート

### レポート機能

Discord Webhookが設定されている場合、以下のレポートが送信されます：

1. **全体資産計算レポート:** 1時間ごとに、各取引所の全資産をJPY換算で計算し、Discordに投稿します。
2. **戦略と銘柄ごとの損益レポート:** 1時間ごとに、各取引所の戦略と銘柄ごとの損益、保有量、評価額などを計算し、Discordに投稿します。
3. **残高整合性チェックレポート:** Redis管理残高と実際の取引所残高を通貨別に合算比較し、不整合があればDiscordに警告を送信します。

### Web UI

Web UIが実装されており、Webブラウザからボットの状態を監視したり、履歴を確認したりすることができます。

#### 概要

- **ダッシュボード (`/`)**: 現在のサマリー情報（総資産、損益など）
- **ポジション (`/positions.html`)**: 現在保有しているポジションの状況をリアルタイムで確認
- **取引履歴 (`/history.html`)**: ボットが実行した注文の履歴を確認
- **約定履歴 (`/filled-history.html`)**: 実際に約定した取引の履歴を詳細に確認
- **分析 (`/analysis.html`)**: 損益グラフや取引統計などのパフォーマンス分析

#### 使い方

1. **データベースサーバー** および **MongoDBサーバー** が起動していることを確認
2. ボットとWeb UIサーバーを起動
   ```bash
   # Dockerの場合
   docker compose up -d bot web-ui
   
   # 通常実行の場合
   npm start &
   npm run start-web &
   ```
3. Webブラウザで `http://localhost:3000` にアクセス

## 🔧 設定

### 基本設定

共通設定や各戦略のデフォルトパラメータは `src/config.js` ファイル内の `config` オブジェクトにあります。

```javascript
const config = {
  // 共通設定
  amount: 0.0001,          // 注文する最低量
  tradePercentage: 0.01,   // 資金の%で取引 (購入時)

  // 戦略固有の設定
  strategies: {
    MA: {
      enabled: process.env.STRATEGY_MA_ENABLED === 'true',
      shortPeriod: 5,
      longPeriod: 20
    },
    // ... 他の戦略設定
  }
};
```

### 環境変数による設定

戦略の有効/無効 (`enabled`) は、`.env` ファイルで `STRATEGY_<戦略名>_ENABLED=true/false` のように設定することで、`config.js` の設定を上書きできます。

### APIスロットリング設定

harvest3システムは、取引所API制限に対応するための包括的なスロットリング機能を実装しています。

#### 現在の設定（安定性重視）
- **RATE_LIMIT**: 15000ms（15秒間隔）
- **MAX_THROTTLE_QUEUE_SIZE**: 5000
- **MAX_CONCURRENT_PAIRS**: 1
- **EXECUTION_DELAY_MS**: 5000ms

詳細設定については [APIスロットリングガイド](./docs/api-throttling-guide.md) を参照してください。

## 🔬 高度な機能

### 実データ収集・分析システム

レビューアから強く求められた「理論値から実証値への移行」を実現するシステムです。実際の取引所APIの応答時間、成功率、システムメトリクスを収集し、理論的な設定値と実測値の乖離を分析・最適化します。

#### 主要機能

- **30日間の実データ収集**: 継続的なパフォーマンスデータの蓄積
- **理論値vs実測値比較**: 設定値の有効性を実証データで検証
- **自動閾値最適化**: 実測データに基づく推奨設定値の算出
- **リアルタイム分析**: 継続的なシステム健全性監視

#### 実行方法

```bash
# 実データ収集の開始（30日間継続）
npm run collect-real-data

# 収集済みデータの分析
npm run analyze-real-data

# 設定値の検証
npm run validate-config
npm run validate-config-structural
```

### データベース

このボットは、データの種類に応じて **Redis** と **MongoDB** の両方のデータベースを利用します。

- **Redis**: リアルタイムな取引記録、現在のポジション情報、イベント通知、各種サマリー情報など
- **MongoDB**: 注文履歴 (`orders`)、約定履歴 (`trades`)、戦略シグナル (`signals`) など、永続的に保存する履歴データ

### テストフレームワーク

プロジェクトには Jest を使用したユニットテストが含まれています。

```bash
# すべてのテストを実行
npm run test

# ユニットテストのみ実行
npm run test:unit

# 監視モードでテストを実行
npm run test:watch
```

## 🐛 既知の問題とロードマップ

### 現在対応中の課題

以下の課題について、[GitHub Issues](https://github.com/your-repo/issues) で継続的に改善を行っています：

- **Issue #203**: テストカバレッジの向上とE2Eテスト再有効化
- **Issue #204**: エラーハンドリングの改善（防御的プログラミング）
- **Issue #205**: パフォーマンス最適化（不要API呼び出し削減）
- **Issue #206**: 開発環境の設定改善
- **Issue #207**: Dockerコンテナの最適化
- **Issue #208**: リアルタイム監視の強化
- **Issue #209**: 実データ分析の活用強化
- **Issue #210**: 独自throttle実装の技術的負債解消
- **Issue #211**: 設定値のハードコード問題解決
- **Issue #212**: マジックナンバーの排除・エラー処理の堅牢化

### 最新の改善点

#### v3.0の主な更新内容

- **MarketDataProvider**: 中央集約化されたティッカーデータ管理システムを実装
- **包括的APIスロットリング**: 段階的バックオフと並列実行制限による安定性向上
- **イベント駆動アーキテクチャ**: 非効率的なポーリングからイベント駆動型への移行
- **MongoDB接続エラー修正**: bufferMaxEntries関連のエラーを解決
- **null参照エラー修正**: システム全体の安定性を向上
- **ポジション整合性改善**: 残高チェック機能の最適化

## 🔗 参考資料

### 詳細ドキュメント

- [📋 緊急対応ガイド](./docs/emergency-troubleshooting.md)
- [🚀 APIスロットリングガイド](./docs/api-throttling-guide.md)
- [🔧 設定詳細ガイド](./docs/current-config.md)
- [🏗️ アーキテクチャ文書](./docs/architecture.md)

### 継続的インテグレーション (CI)

本プロジェクトではGitHub Actionsによる継続的インテグレーションが設定されています。メインブランチへのプッシュやプルリクエスト時に自動的に以下が実行されます：

- Node.js環境のセットアップ
- 依存関係のインストール
- Jestテストの実行
- カバレッジレポートの生成

## ⚠️ 注意事項

- 実際の取引に使用する場合は、自己責任で行ってください。
- 暗号通貨取引には高いリスクが伴います。投資は自己責任で行ってください。
- APIキーは他人に漏れないように厳重に管理してください。
- レポート機能やWeb UIの表示は参考情報であり、実際の損益と完全に一致しない場合があります。
- 戦略ごとの損益は、その戦略が行った取引のみを対象としており、手数料や他の要因は考慮されていない場合があります。

## 📄 ライセンス

MIT