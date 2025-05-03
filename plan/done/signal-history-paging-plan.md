# シグナル履歴ページ ページング実装計画

## 目的

シグナル履歴ページのデータ量が多すぎる場合にページが重くなる問題を解消するため、データをページングして取得・表示するように変更する。

## 概要

現在のクライアントサイドでの全件データ取得・表示から、サーバーサイドでのページングデータ取得・表示に切り替える。

## 計画詳細

### 1. バックエンド (`src/api/controllers/signals.js`) の変更

*   `/api/signals` エンドポイントが、リクエストパラメータからページング情報（`start`, `length`）を受け取るように修正する。
*   データベース（MongoDBを想定）からデータを取得する際に、受け取った `start` と `length` を使用して、取得するデータの範囲を制限する（`skip()` と `limit()`）。
*   既存のフィルタリング条件（取引所、銘柄、売買区分、日付範囲）に一致するデータの総件数を別途カウントし、レスポンスに含める（`recordsFiltered`）。
*   フィルタリングなしの全データの総件数も取得し、レスポンスに含める（`recordsTotal`）。
*   レスポンス形式をDataTablesのサーバーサイド処理が期待する以下のJSON形式に合わせる。

    ```json
    {
      "data": [...], // 取得したシグナルデータの配列
      "recordsTotal": 1000, // フィルタリングなしの全件数
      "recordsFiltered": 500 // フィルタリング後の総件数
    }
    ```

### 2. フロントエンド (`src/web/js/signal-history.js`) の変更

*   DataTablesの初期化オプションに以下の設定を追加する。
    *   `serverSide: true`: サーバーサイド処理を有効にする。
    *   `processing: true`: 処理中にローディングインジケーターを表示する。
    *   `pageLength: 50`: 1ページあたりの表示件数を50件に設定する。
*   DataTablesの `ajax` オプションを設定し、DataTablesがページング、ソート、検索のために送信するパラメータを処理し、`/api/signals` エンドポイントへのリクエストURLに変換するようにする。
    *   `ajax.url`: `/api/signals`
    *   `ajax.type`: `'GET'`
    *   `ajax.data`: DataTablesが送信するパラメータオブジェクトを受け取り、バックエンドAPIが必要とする形式（既存のフィルタパラメータ + `start`, `length` など）に変換して返す関数を定義する。
*   DataTablesがAPIから受け取るデータの形式を、バックエンドのレスポンス形式に合わせて調整する（`ajax.dataSrc`）。デフォルトではレスポンスの `data` プロパティを期待するため、バックエンドのレスポンス形式が合っていれば特別な設定は不要かもしれない。
*   `loadSignals` 関数内で手動でfetch APIを呼び出している既存のコードは削除し、DataTablesのajaxオプションにデータ取得処理を委譲する。
*   フィルタ適用ボタン (`#apply-filter`) のクリックイベントハンドラ内で、`loadSignals()` の代わりに `signalsTable.ajax.reload()` を呼び出し、DataTablesに新しいフィルタ条件でデータを再読み込みさせるように変更する。

## 想定される影響範囲

*   `src/api/controllers/signals.js`: `/api/signals` エンドポイントのデータ取得ロジックとレスポンス形式の変更。
*   `src/web/js/signal-history.js`: DataTablesの初期化オプション、データ取得ロジックの変更。
*   `src/web/signal-history.html`: DataTablesの標準ページングUIが自動的に表示されるため、HTML自体の大きな変更は不要だが、DataTablesに関連するクラスやIDが適切か確認。

## 実施手順

1.  バックエンド (`src/api/controllers/signals.js`) の変更を実装する。
2.  フロントエンド (`src/web/js/signal-history.js`) の変更を実装する。
3.  ローカル環境で動作確認を行い、ページングが正しく機能すること、フィルタリングが引き続き機能することを確認する。
4.  必要に応じて、パフォーマンスのボトルネックがないか確認する。

## Mermaid図

```mermaid
graph TD
    A[ユーザー操作: ページ表示/フィルタ適用] --> B{フロントエンド: signal-history.js}
    B --> C[DataTables初期化/再読み込み]
    C --> D{DataTables Ajaxリクエスト}
    D --> E[リクエストパラメータ生成: ページング, フィルタ]
    E --> F{バックエンドAPI: /api/signals}
    F --> G[データベースクエリ実行: フィルタ, スキップ, リミット]
    G --> H[総件数取得]
    H --> I[レスポンス生成: データ, 総件数]
    I --> J{フロントエンド: DataTables}
    J --> K[データ表示 & ページングUI更新]