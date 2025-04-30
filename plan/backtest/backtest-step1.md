# Backtest Functions Preparation - Step 1

## 目的

バックテストシステムのためのデータ取得ロジックを設計し、`fetchOHLCVData` および `fetchTicker` 関数の修正・新規実装の詳細を定義する。

## 設計詳細

## 0. `src/database/mongoDatabase.js` : fetchOHLCVData 関数実装
*   args: exchangeId, symbol, timestamp, limit
*   MongoDB (`src/database/mongoDatabase.js` の関数を利用) から、指定された `timestamp` までのOHLCVデータを件数(limit)分取得する。
*   timestamp の降順で取得

### 1. `src/database/managers.js` : fetchOHLCVData 関数修正

*   **現在のシグネチャ:** `fetchOHLCVData(exchange, symbol, timeframe, limit)`
*   **修正後のシグネチャ:** `fetchOHLCVData(exchange, symbol, timeframe, limit, options = {})`
*   **`options` オブジェクト:**
    *  オプショナル引数
    *   `backtestTimestamp`: バックテストの終了タイムスタンプ (number, milliseconds)
*   **ロジック:**
    *   `options.backtestTimestamp` が `null` でない場合:
        * mongoDatabase.js から fetchOHLCVData を呼び出す
        * 形を現状のOHCLVデータに変換して返す
    *   `options.backtestTimestamp` および options が未定義の場合:
        *   既存のリアルタイムデータ取得ロジック（取引所APIからの取得）を実行する。

### 2. `src/database/manager.js` に `fetchTicker` 関数の新規実装

*   **関数名:** `fetchTicker`
*   **引数:** `exchange`, `symbol`, `options = {}`
*   **`options` オブジェクト:**
    *   `backtestTimestamp`: バックテストの終了タイムスタンプ (number, milliseconds)。
    *   `ohlcvData`: バックテストシナリオで使用するOHLCVデータの配列。
*   **ロジック:**
    *   `options.backtestTimestamp` が存在する場合（バックテストシナリオ）:
        *   提供された `options.ohlcvData` 配列の末尾（最新値）の各要素の値(Open, High, Low, Close) の平均値を計算する。
        *   計算した平均値をティッカー値として返す。
    *   `options.backtestTimestamp` が存在しない場合（リアルタイムシナリオ）:
        *   取引所API (`exchange.fetchTicker`) を使用して現在のティッカーデータを取得する。
        *   取得したティッカー値を返す。


## 次のステップ

この計画に基づき、コードの実装を行います。