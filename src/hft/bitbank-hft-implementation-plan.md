# bitbank WebSocketを活用したHFT戦略実装計画

## 1. 概要

本計画ではbitbankのWebSocket API（Socket.IO 4.x、Engine.IO protocol v4）を使用して、高頻度取引（HFT）戦略を再実装します。スケーラビリティを重視し、複数通貨ペアを同時に監視・取引できる仕組みを実現します。

### 目的
- RESTベースのAPIから低レイテンシーのWebSocket APIへの移行
- 複数通貨ペアの同時監視・取引の実現
- 既存の戦略ロジックの維持と強化

## 2. ファイル構造

```
src/
  hft/
    index.js                  - メインエントリポイント
    config.js                 - 設定と通貨ペア定義
    bitbank/
      WebSocketClient.js      - Socket.IO接続管理
      PublicStreamClient.js   - パブリックストリームハンドラ
      PrivateStreamClient.js  - プライベートストリームハンドラ
    strategy/
      HFTStrategy.js          - 高頻度取引戦略実装
      OrderProcessor.js       - 注文処理
    datastore/
      MarketDataStore.js      - マーケットデータ管理
    utils/
      Logger.js               - ロギングユーティリティ
      RateLimiter.js          - API制限管理
```

## 3. 主要コンポーネント

### 3.1 設定ファイル (config.js)

```javascript
// 取引対象の通貨ペア
const TRADING_PAIRS = [
  'btc_jpy',
  'xrp_jpy',
  'eth_jpy',
];

// WebSocket接続設定
const WS_CONFIG = {
  publicStreamEndpoint: 'wss://stream.bitbank.cc/socket.io',
  privateStreamEndpoint: 'wss://stream.bitbank.cc/socket.io',
  reconnectInterval: 3000,
  maxReconnectAttempts: 10
};

// 戦略パラメータ
const STRATEGY_PARAMS = {
  priceThreshold: 0.001,      // 価格変動閾値（%）
  orderBookDepth: 15,         // 注文板の深さ
  interval: 100,              // 評価間隔（ms）
  tradePercentage: 0.01       // 資金の使用割合
};
```

### 3.2 WebSocketクライアント

Socket.IO 4.xクライアントを実装し、bitbankのWebSocket APIに接続します。主な機能：
- 自動再接続メカニズム
- イベントハンドリング
- エラー処理

```javascript
// 接続例
this.socket = io(endpoint, {
  transports: ['websocket'],
  reconnection: false,  // 自前で再接続処理を実装
  timeout: 10000
});

// 部屋参加（チャネル購読）
this.socket.emit('join-room', `depth_whole_${pair}`);
```

### 3.3 パブリックストリーム処理

bitbankパブリックストリームから以下のデータを購読：
- depth_whole（注文板全体）
- depth_diff（注文板差分）
- ticker（ティッカー）
- transactions（約定履歴）

```javascript
// 購読例
subscribePair(pair) {
  // 注文板全体
  this.client.socket.emit('join-room', `depth_whole_${pair}`);
  // 注文板差分
  this.client.socket.emit('join-room', `depth_diff_${pair}`);
  // ティッカー
  this.client.socket.emit('join-room', `ticker_${pair}`);
  // 約定履歴
  this.client.socket.emit('join-room', `transactions_${pair}`);
}
```

### 3.4 マーケットデータストア

複数通貨ペアの市場データを管理し、更新をリアルタイムに処理します：
- 注文板データの管理と差分適用
- ティッカーデータの更新
- 取引履歴の蓄積
- イベント通知メカニズム

### 3.5 HFT戦略ロジック

WebSocketデータに基づいた高頻度取引戦略を実装：
- 現在のHFT戦略の主要ロジックを維持
- リアルタイムデータに基づく判断
- 買い圧力/売り圧力の分析
- 価格変動閾値に基づく取引実行

```javascript
// 注文板データ処理例
async processOrderBook(orderBookData) {
  // 最良価格を取得
  const bestBid = parseFloat(orderBookData.bids[0][0]);
  const bestAsk = parseFloat(orderBookData.asks[0][0]);
  
  // 中間価格を計算
  const midPrice = (bestBid + bestAsk) / 2;
  
  // 価格変動を計算
  const priceChange = ((midPrice - this.previousPrice) / this.previousPrice) * 100;
  
  // 取引判断
  if (Math.abs(priceChange) >= this.priceThreshold) {
    // 取引実行ロジック
  }
  
  // 価格を記録
  this.previousPrice = midPrice;
}
```

### 3.6 メインマネージャー

全体を統括し、複数通貨ペアの同時処理を管理：
- WebSocket接続の確立
- 通貨ペアごとのストラテジー初期化
- データ購読設定
- エラー処理と再試行ロジック

```javascript
async start() {
  // WebSocket接続
  await this.publicClient.connect();
  
  // 取引ペアごとにストラテジー作成と購読開始
  for (const pair of TRADING_PAIRS) {
    await this._initializePair(pair);
  }
}
```

## 4. データベース連携

既存のデータベース関数を活用して注文と取引を管理：
- `addOrder`: 注文情報の記録
- `getRealizedPnL`: 実現損益の取得
- `formattedAvailableAmount`: 利用可能な取引量の計算
- `checkBuyOrderAllowance`: 買い注文可能性のチェック

## 5. 実装ステップ

1. **WebSocketクライアントの実装**
   - Socket.IO 4.xを使用したクライアント実装
   - bitbank API仕様に基づく接続処理
   - 再接続メカニズムのテスト

2. **データストアの実装**
   - データ構造の設計
   - 注文板差分適用アルゴリズムの実装
   - イベント通知システムの構築

3. **HFT戦略の実装**
   - 現在の戦略ロジックの移植
   - WebSocketベースの処理に変更
   - 単一通貨ペアでのテスト

4. **マルチペア対応の実装**
   - 複数通貨ペアの同時処理
   - リソース管理とスケーリング
   - パフォーマンス最適化

5. **統合とテスト**
   - 既存システムとの統合
   - エラー処理とログ記録の強化
   - 本番環境での検証

## 6. 統合方法

`src/config.js`内で新しいHFT戦略を有効化し、既存のシステムと統合します：

```javascript
// src/config.js
const { startHFTStrategy } = require('./hft');

const config = {
  strategies: {
    HFT: {
      enabled: true,
      function: startHFTStrategy,
      atomicExec: true,
      exchanges: [exchangeBB],
    },
  }
};
```

## 7. 参考資料

- [bitbank パブリックストリームAPI仕様](https://github.com/bitbankinc/bitbank-api-docs/blob/master/public-stream_JP.md)
- [bitbank プライベートストリームAPI仕様](https://github.com/bitbankinc/bitbank-api-docs/blob/master/private-stream.md)
- [Socket.IO 4.x クライアントドキュメント](https://socket.io/docs/v4/client-api/)