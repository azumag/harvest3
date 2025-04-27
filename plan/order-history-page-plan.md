# 注文履歴表示ページ追加計画

## 概要
`src/web` に注文履歴表示ページを追加する。注文履歴データは `src/database/manager.js` の `listOrders` 関数を使用して取得し、UIで定義されたフィルタ条件を適用可能とする。

## 表示項目
- 取引所
- 銘柄
- 売買区分
- 価格
- 数量
- 注文ID
- 注文タイプ
- タイムスタンプ

## フィルタ条件
- 取引所
- 銘柄
- 売買区分
- 期間（開始日・終了日）

## 詳細計画

### ステップ 1: バックエンドAPIエンドポイントの追加
- `src/api/routes.js` に `/api/orders` のような新しいGETエンドポイントを追加します。
- 新しいコントローラファイル (`src/api/controllers/orders.js` など) を作成します。
- コントローラ内で `src/database/manager.js` の `listOrders` 関数を呼び出します。
- クエリパラメータとしてフィルタ条件（取引所、銘柄、売買区分、開始日、終了日）を受け取り、`listOrders` 関数に渡すフィルタオブジェクトを構築します。
- 取得した注文データをJSON形式で返します。

### ステップ 2: フロントエンドHTMLファイルの作成
- `src/web/history.html` ファイルを新規作成します。
- `src/web/index.html` を参考に、BootstrapやDataTablesのCSS/JSを読み込みます。
- フィルタ用のフォーム要素（ドロップダウン、日付ピッカーなど）と、注文履歴を表示するためのテーブル要素（DataTablesが利用できる形式）を配置します。
- ナビゲーションバーを読み込むためのコンテナ (`<div id="navbar-container"></div>`) を含めます。

### ステップ 3: フロントエンドJavaScriptファイルの作成
- `src/web/js/history.js` ファイルを新規作成します。
- DOMContentLoadedイベントで初期化処理を行います。
- ナビゲーションバーを読み込みます (`js/navbar.js` を利用)。
- フィルタフォームの入力値を取得し、APIエンドポイントにリクエストを送信する関数を実装します。
- APIから取得したデータをDataTablesに表示する処理を実装します。
- フィルタ条件が変更されたときにデータを再取得して表示を更新するイベントリスナーを設定します。
- 期間フィルタのために、日付ピッカーライブラリ（例: Bootstrap Datepicker, flatpickrなど）の導入を検討します。

### ステップ 4: ナビゲーションバーの確認
- `src/web/navbar.html` に `history.html` へのリンクが既に存在することを確認します。

## 処理フロー図

```mermaid
graph TD
    A[ユーザー操作] --> B[history.htmlアクセス]
    B --> C[history.html読み込み]
    C --> D[history.js実行]
    D --> E[フィルタ条件取得]
    E --> F[APIリクエスト /api/orders]
    F --> G[src/api/routes.js]
    G --> H[src/api/controllers/orders.js]
    H --> I[src/database/manager.js listOrders]
    I --> J[MongoDB]
    J --> I
    I --> H[注文データ取得]
    H --> G
    G --> F[APIレスポンス]
    F --> D[history.js データ処理]
    D --> K[DataTables表示更新]