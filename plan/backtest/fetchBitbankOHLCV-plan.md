# Bitbank OHLCVデータ取得・保存スクリプトの作成計画

## 目的

Bitbankの全ての銘柄に関して、`src/common/const.js` で定義されている全てのタイムフレームの組み合わせで、一年分のOHLCVデータを取得し、`architecture/database.md` の `ohlcv` で定義されている形式でMongoDBに保存する新しいスクリプトを作成する。

## 計画詳細

1.  **`src/database/mongoDatabase.js` の修正:**
    *   OHLCVデータをMongoDBに保存するための非同期関数 `addOhlcvMongoDB(ohlcvData)` を追加します。
    *   この関数は、`architecture/database.md` の `ohlcv` スキーマに従ってデータを整形し、MongoDBの `ohlcv` コレクションに挿入します。
    *   重複データの挿入を防ぐため、`exchange`, `symbol`, `timeframe`, `timestamp` の組み合わせでユニークインデックスを作成することを検討します。（これは実装時にCodeモードで行います）

2.  **`src/database/manager.js` の修正:**
    *   `src/database/mongoDatabase.js` から `addOhlcvMongoDB` 関数をインポートし、エクスポートリストに追加します。

3.  **新しいスクリプトファイル `scripts/fetchBitbankOHLCV.js` の作成:**
    *   必要なモジュール（`exchangeBB`、`OHLCVTimeFrames`、`fetchOHLCVData`、`addOhlcvMongoDB`、`initializeDB`）をインポートします。
    *   `initializeDB()` を呼び出し、DB接続を確立します。
    *   `exchangeBB.loadMarkets()` を使用してBitbankの全銘柄リストを取得します。
    *   取得した銘柄リストと `OHLCVTimeFrames` の各タイムフレームをループ処理します。
    *   各銘柄・タイムフレームの組み合わせに対し、1年分のOHLCVデータを取得するための `limit` を計算します。
        *   1年間の各タイムフレームのローソク足の本数を計算します。
            *   1m: 60分 * 24時間 * 365日 = 525,600
            *   5m: 12 * 24 * 365 = 105,120
            *   15m: 4 * 24 * 365 = 35,040
            *   30m: 2 * 24 * 365 = 17,520
            *   1h: 24 * 365 = 8,760
            *   4h: 6 * 365 = 2,190
            *   1d: 365
            *   1w: 52
        *   計算した値を `limit` として `fetchOHLCVData` を呼び出します。
    *   取得したOHLCVデータをループ処理し、各OHLCVレコードを `addOhlcvMongoDB` 関数を使ってMongoDBに保存します。
    *   エラーハンドリングと処理の進捗状況をコンソールに出力するログを追加します。
    *   DB接続を閉じる処理を追加します。

## 想定される成果物

-   `src/database/mongoDatabase.js` に `addOhlcvMongoDB` 関数の追加
-   `src/database/manager.js` に `addOhlcvMongoDB` のインポートとエクスポートの追加
-   新しいスクリプトファイル `scripts/fetchBitbankOHLCV.js` の作成
-   MongoDBの `ohlcv` コレクションにBitbankのOHLCVデータが保存される

