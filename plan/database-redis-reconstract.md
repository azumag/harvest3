# database の再構成

履歴関連を MongoDB でもち、サマリーや即時系、パラメータ、通貨ペア情報を Redis 債務にする。

## サマリーについて
### 注文サマリー
- 現在出ている注文の状態を確認するためのサマリー
- 売り買いに出している量、平均価格, strategy

### 約定サマリー
- 約定した情報を確認する
- 戦略ごとの取引損益、手数料、売り買いした量、平均価格

## 履歴
### 戦略の実行観点
- 約定履歴はサマリー計算の重複判定のためだけに必要
- 注文履歴はサマリー計算の戦略判定のためだけに必要

### 分析の観点
取引履歴詳細やシグナル履歴は永続化し, 扱いやすいローカルで持っておきたい

# Redis構成
- summary
  - order    : 現在注文中サマリ
  - trade    : 現在約定サマリ
- current
  - orderPair : オーダーペア保存領域 戦略によってはつかう
- params      : 取引所・通貨・戦略ごとのパラメータ

## summary
### order
Key: `summary:order:${exchange}:${symbol}:${strategy}`
Redis Hash
```json
{
  "buyAmount": float,       // 買い注文の総量
  "sellAmount": float,      // 売り注文の総量
  "totalBuyCost": float,    // 買い注文の総価格
  "totalSellValue": float,  // 売り注文の総価格
  "netPosition": float,     // ポジション
  "createdAt": timestamp,   // 作成日時
  "updatedAt": timestamp    // 更新日時
}
```

### trade
Key `summary:trade:${exchange}:${symbol}:${strategy}`
Redis hash
```json
{
  "buyAmount": float,       // 買い約定の総量
  "sellAmount": float,      // 売り約定の総量
  "totalBuyCost": float,    // 買い約定の総コスト
  "totalSellValue": float,  // 売り約定の総価値
  "netPosition": float,     // ポジション
  "totalFee": float,        // 総手数料
  "realizedPnL": float,     // 実現損益
  "createdAt": timestamp,   // 作成日時
  "updatedAt": timestamp    // 更新日時
}
```

## current
### orderPair
Key `current:orderPair:${exchange}:${symbol}:${strategy}`
Redis hash
```json
{
  "pair": {
    "sellOrder": {
      "id": "44994330477",
      "datetime": "2025-04-13T19:37:53.275Z",
      "timestamp": 1744573073275,
      "status": "open",
      "symbol": "RENDER/JPY",
      "type": "limit",
      "side": "sell",
      "price": 552.28,
      "cost": 0,
      "amount": 0.1815,
      "filled": 0,
      "remaining": 0.1815,
      "trades": [],
      "info": {
        "order_id": "44994330477",
        "pair": "render_jpy",
        "side": "sell",
        "type": "limit",
        "start_amount": "0.1815",
        "remaining_amount": "0.1815",
        "executed_amount": "0.0000",
        "user_cancelable": true,
        "price": "552.280",
        "average_price": "0.000",
        "ordered_at": "1744573073275",
        "status": "UNFILLED",
        "expire_at": "1760125073275",
        "post_only": false
      },
      "fees": []
    },
    "amount": 0.1815,
    "buyFilled": false,
    "sellFilled": false,
    "buyOrder": {
      "id": "44995324839",
      "datetime": "2025-04-13T20:11:29.951Z",
      "timestamp": 1744575089951,
      "status": "open",
      "symbol": "RENDER/JPY",
      "type": "limit",
      "side": "buy",
      "price": 544.907,
      "cost": 0,
      "amount": 0.1815,
      "filled": 0,
      "remaining": 0.1815,
      "trades": [],
      "info": {
        "order_id": "44995324839",
        "pair": "render_jpy",
        "side": "buy",
        "type": "limit",
        "start_amount": "0.1815",
        "remaining_amount": "0.1815",
        "executed_amount": "0.0000",
        "user_cancelable": true,
        "price": "544.907",
        "average_price": "0.000",
        "ordered_at": "1744575089951",
        "status": "UNFILLED",
        "expire_at": "1760127089951",
        "post_only": false
      },
      "fees": []
    }
  }
}
```

## params
取引所・銘柄・戦略ごとのパラメータを保存
Key: `params:${exchange}:${symbol}:${strategy}`
```json
{
    "enabled": true,
    "period": 30,
    ...
}
```

# MongoDB 構成
分析用, 履歴などを永続化して保存するための DB

- orders    # 注文履歴 注文IDから戦略キーを取得するためにインデックスを貼る、またユニーク制約をつける
- signals   # シグナル履歴
- trades    # 約定履歴 取引IDでユニーク制約をつける。オーダーとは部分約定があるため多対一の関係になる
- tickers   # ティッカー履歴
- ohlc      # ロウソク足履歴
- orderBook # 板情報履歴

## orders
```json
{
  "_id": ObjectId("..."),
  "orderId": "45233562369",
  "exchange": "bitbank",
  "symbol": "BTC/JPY",
  "strategy": "HFT",
  "amount": 127.0623,
  "side": "buy",
  "price": 3.735,
  "orderType": "limit",
  "orderedAt": 1745302022253
}
```
find example: `const order = await db.orders.findOne({ orderId: "xxxx" });`

index
```js
db.orders.createIndex({ orderId: 1 }, { unique: true })
db.orders.createIndex({ timestamp: 1 })  // 昇順
db.orders.createIndex({ timestamp: -1 }) // 降順
```

## signals
```json
{
  "_id": ObjectId("..."),
  "timestamp": 1745302022253,
  "exchange": "bitbank",
  "symbol": "XRP/JPY",
  "strategy": "HFT",
  "signalType": "buy",
  "price": 342342.44,
  "signalDetail": {
    ...
  }
}
```
signalDetail には各戦略で使われている指標のセットが入る。たとえば `MEAN_REVERSION` の場合
```json
{
  "rsi": 87.40004569339726,
  "oversoldThreshold": 30,
  "overboughtThreshold": 70
}
```

index
```js
db.signals.createIndex({ timestamp: 1 })
db.signals.createIndex({ timestamp: -1 })
```

## trades
```json
{
  "_id": ObjectId("..."),
  "exchange": "bitbank",
  "symbol": "XRP/JPY",
  "strategy": "HFT",
  "orderId": "45233478289",
  "tradeId": "xxxxxxxxxxx",
  "amount": 0.227,
  "side": "buy",
  "price": 525.132,
  "orderType": "limit",
  "fee": -0.0238,
  "filledAt": 1745302072676
}
```

index
```js
db.trades.createIndex({ orderId: 1 })
db.trades.createIndex({ tradeId: 1 }, { unique: true })
```

# tickers
# olhc
# orderBook
未実装