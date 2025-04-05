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

## 設定

`bot.js`ファイル内の`config`オブジェクトで、各戦略のパラメータを設定できます。

```javascript
const config = {
  // 共通設定
  amount: 0.0001,  // 注文するBTCの量
  profitMargin: 0.003,  // 目標利益率（取引料を考慮）
  maxHistoryLength: 100,  // スプレッド履歴の最大長
  tradePercentage: 0.02,  // 資金の%で取引
  sellPercentage: 0.1, // 売却可能量の%で取引
  tradeCost: 0.0012, // 手数料暫定（bitbank)
  cancelOrderThreshold: 30, // 一銘柄ごとの注文限度数
  safetyJPYAmount: 2000, // JPY残高がこの額を下回ったら購入しない（HFTのときのみ）
  
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
docker-compose up -d
```

## 注意事項

- 実際の取引に使用する場合は、自己責任で行ってください。
- 暗号通貨取引には高いリスクが伴います。投資は自己責任で行ってください。
- APIキーは他人に漏れないように注意してください。

## ライセンス

MIT