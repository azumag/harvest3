# Backtest Functions Preparation - Step 1

## 目的

バックテストシステムのためのデータ取得ロジックを設計し、`fetchOHLCVData` および `fetchTicker` 関数の修正・新規実装の詳細を定義する。

## 設計詳細
### 方針
- 注文が全て約定する前提
- 手数料を考慮しない
- ticker など取得が困難なものは別で計算できるもので代替する

### **`options:backtest` オブジェクト:**
各関数に options を渡せるようにし、 backtest に設定が入っているかどうかで扱う。
これは backtest 中の状態も表し、適宜アップデートする
*  オプショナル引数
*   `timestamp`: バックテストの実行タイムスタンプ (number, milliseconds)
*   `totalSellCost`: 売った額
*   `totalBuyCost`: かったがく
*   `baseFund`: 最初の資金
*   `ohlcvData`: 現状使ってるロウソク足データ
*   `lastSignal`: 'buy' or 'sell'
*   `currentAmount`

### 1. `src/database/manager.js` : fetchOHLCVData 関数修正

*   **現在のシグネチャ:** `fetchOHLCVData(exchange, symbol, timeframe, limit)`
*   **修正後のシグネチャ:** `fetchOHLCVData(exchange, symbol, timeframe, limit, options = {})`
*   **ロジック:**
    *   `options.backtest` が `null` でない場合:
        * mongoDatabase.js から fetchOHLCVData を呼び出す. paramter に options.backtest.timestamp 使う
        * 形を現状のOHCLVデータに変換して返す
    *   `options.backtest` および options が未定義の場合:
        *   既存のリアルタイムデータ取得ロジック（取引所APIからの取得）を実行する。

### 2. `src/database/manager.js` に `fetchTicker` 関数の新規実装

*   **関数名:** `fetchTicker`
*   **引数:** `exchange`, `symbol`, `options = {}`
*   **ロジック:**
    *   `options.backtest` が存在する場合（バックテストシナリオ）:
        *   提供された `options.backtest.ohlcvData` 配列の末尾（最新値）の各要素の値(Open, High, Low, Close) の平均値を計算する。
        *   計算した平均値をティッカー値として返す。
    *   `options.backtest` が存在しない場合（リアルタイムシナリオ）:
        *   取引所API (`exchange.fetchTicker`) を使用して現在のティッカーデータを取得する。
        *   取得したティッカー値を返す。


## 次のステップ

この計画に基づき、コードの実装を行います。