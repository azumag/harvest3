# 暗号通貨取引ボット

このプロジェクトは、複数の取引戦略を実装した暗号通貨取引ボットです。ccxtライブラリを使用して、複数の取引所（bitbank、bitflyer）に接続し、自動取引を行います。

## 実装されている戦略

### トレンドフォロー戦略

- **移動平均線クロス**: 短期と長期の移動平均線が交差する点を売買シグナルとするシンプルな戦略です。
- **MACD (Moving Average Convergence Divergence)**: 2つの移動平均線の差と、その移動平均線を利用してトレンドの方向性や勢いを判断します。
- **RSI (Relative Strength Index)**: 買われすぎや売られすぎの水準を判断し、反転を狙う指標です。
- **ボリンジャーバンド**: 価格の変動幅を統計的に捉え、上限や下限に達した際に逆張りをする戦略や、バンド幅の拡大でトレンドの発生を予測する戦略があります。

### 逆張り戦略

- **平均回帰**: 価格は長期的には平均値に戻るという考えに基づき、大きく乖離した際に逆張りをする戦略です。
- **オシレーター系指標の利用**: RSIやストキャスティクスなどのオシレーター系指標が買われすぎや売られすぎの水準を示す際に、反転を狙います。

### アービトラージ戦略

- **価格差取引**: 複数の取引所間でビットコインの価格差が生じた際に、安い取引所で買って高い取引所で売ることで利益を得る戦略です。

### 高頻度取引 (HFT)

- **高頻度取引**: 極めて短い時間間隔で大量の取引を行い、小さな利益を積み重ねる戦略です。
- **スキャルピング**: スプレッド（買値と売値の差）に基づいて取引を行う戦略です。

## セットアップ

### 前提条件

- Node.js (v14以上)
- npm または yarn
- bitbankとbitflyerのAPIキー

### インストール

1. リポジトリをクローン

```bash
git clone <リポジトリURL>
cd <プロジェクトディレクトリ>
```

2. 依存関係をインストール

```bash
npm install
```

または

```bash
yarn install
```

3. 環境変数の設定

`.env.example`ファイルを`.env`にコピーし、必要な情報を入力します。

```bash
cp .env.example .env
```

`.env`ファイルを編集して、APIキーとDiscord Webhook URLを設定します。

```
BB_API_KEY=your_bitbank_api_key
BB_API_SECRET=your_bitbank_api_secret

BF_API_KEY=your_bitflyer_api_key
BF_API_SECRET=your_bitflyer_api_secret

DISCORD_ERROR_WEBHOOK_URL=your_discord_webhook_url_for_errors
DISCORD_ORDER_WEBHOOK_URL=your_discord_webhook_url_for_orders
DISCORD_RESULT_WEBHOOK_URL=your_discord_webhook_url_for_results
```

### 実行

```bash
npm start
```

または

```bash
yarn start
```

### ポジション解消コマンド

ボットが作成したすべてのポジションを成行で売却し、ポジションを解消するコマンドが用意されています。

```bash
# すべての取引所のポジションを解消
npm run close-all

# BitBankのポジションのみを解消
npm run close-bb

# BitFlyerのポジションのみを解消
npm run close-bf
```

または

```bash
# すべての取引所のポジションを解消
yarn close-all

# BitBankのポジションのみを解消
yarn close-bb

# BitFlyerのポジションのみを解消
yarn close-bf
```

このコマンドは、以下の処理を行います：

1. 指定された取引所の残高を取得
2. JPY以外の通貨で残高がある場合、その通貨を成行注文で売却
3. 売却結果をDiscordに通知
4. 取引記録を更新

注意：このコマンドは一度実行すると、すべてのポジションが解消されます。実行前に必ず確認してください。

#### Dockerでの実行

Docker Composeを使用している場合は、以下のコマンドでポジションを解消できます：

```bash
# ヘルプを表示
docker compose exec bot node src/closeAllPositions.js --help

# すべての取引所のポジションを解消
docker compose exec bot node src/closeAllPositions.js

# BitBankのポジションのみを解消
docker compose exec bot node src/closeAllPositions.js --bitbank

# BitFlyerのポジションのみを解消
docker compose exec bot node src/closeAllPositions.js --bitflyer
```

または、コンテナ名を使用して直接実行することもできます：

```bash
# ヘルプを表示
docker exec scalping_bot node src/closeAllPositions.js --help

# すべての取引所のポジションを解消
docker exec scalping_bot node src/closeAllPositions.js

# BitBankのポジションのみを解消
docker exec scalping_bot node src/closeAllPositions.js --bitbank

# BitFlyerのポジションのみを解消
docker exec scalping_bot node src/closeAllPositions.js --bitflyer
```

## レポート機能

このボットには以下の2種類のレポート機能が実装されています：

### 1. 全体資産計算レポート

1時間ごと（毎時0分）に、各取引所の全資産をJPY換算で計算し、Discordに投稿します。このレポートでは、保有している全ての通貨の合計評価額を確認できます。

### 2. 戦略と銘柄ごとの損益レポート

1時間ごと（毎時0分）に、各取引所の戦略と銘柄ごとの損益を計算し、Discordに投稿します。このレポートには以下の情報が含まれます：

- 各銘柄ごとの各戦略の損益
- 現在の保有量と評価額
- 銘柄ごとの合計損益
- 戦略タイプ（トレンドフォロー、逆張り、アービトラージ、高頻度取引）ごとの合計損益

このレポートにより、どの戦略がどの銘柄で利益を上げているか、または損失を出しているかを詳細に把握できます。

## 設定

`bot.js`ファイル内の`config`オブジェクトで、各戦略のパラメータを設定できます。

```javascript
const config = {
  // 共通設定
  amount: 0.0001,  // 注文するBTCの量
  profitMargin: 0.003,  // 目標利益率（取引料を考慮）
  maxHistoryLength: 100,  // スプレッド履歴の最大長
  tradePercentage: 0.01,  // 資金の%で取引
  tradeCost: 0.0012, // 手数料暫定（bitbank)
  cancelOrderThreshold: 10, // 一銘柄ごとの注文限度数
  safetyJPYAmount: 2000, // JPY残高がこの額を下回ったら購入しない（HFTのときのみ）
  amountPrecision: 8, // 取引量の小数点以下の桁数（デフォルト値）
  
  // 戦略固有の設定
  strategies: {
    // 各戦略の設定...
  }
};
```

各戦略は`enabled`フラグで有効/無効を切り替えることができます。

## Dockerでの実行

Dockerを使用して実行することもできます。

```bash
docker compose up

# hft だけ起動
docker compose up hft
```

## 注意事項

- 実際の取引に使用する場合は、自己責任で行ってください。
- 暗号通貨取引には高いリスクが伴います。投資は自己責任で行ってください。
- APIキーは他人に漏れないように注意してください。
- レポート機能は参考情報であり、実際の損益と完全に一致しない場合があります。
- 戦略ごとの損益は、その戦略が行った取引のみを対象としており、手数料や他の要因は考慮されていない場合があります。

## ライセンス

MIT
