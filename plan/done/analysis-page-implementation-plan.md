# 分析ページ実装計画

## 目的
取引所、銘柄、戦略を選択し、選択された条件に基づいたロウソク足チャートと戦略シグナルを表示する分析ページをWeb UIに追加する。

## 既存リソースの確認
- `/src/web` ディレクトリに既存のHTMLファイル（`index.html`, `order-history.html`など）が存在し、BootstrapとJavaScriptを使用。Chart.jsも利用されている。
- ナビゲーションバー (`navbar.html`) に分析ページへのコメントアウトされたリンクが存在。
- バックエンドAPIとして、取引所リスト (`/api/exchanges`)、銘柄リスト (`/api/symbols`)、ロウソク足データ (`/api/ohlcv`)、シグナル履歴 (`/api/signals`) を取得するエンドポイントが存在する。
- 戦略リストを取得する直接的なAPIエンドポイントは現時点では確認されていない。

## 実装計画詳細

1.  **新しいHTMLファイル `src/web/analysis.html` の作成**:
    *   Bootstrapを使用した基本的なページ構造を定義。
    *   ナビゲーションバー読み込み用のコンテナ (`<div id="navbar-container"></div>`) を配置。
    *   取引所、銘柄、戦略を選択するためのドロップダウンを含むフィルタリングUIを作成。
    *   ロウソク足チャート描画用の `canvas` 要素 (`<canvas id="ohlcvChart"></canvas>`) を配置。
    *   必要なJavaScriptライブラリ（jQuery, Bootstrap, Chart.js, flatpickrなど）およびカスタムJavaScriptファイル (`js/analysis.js`) を読み込む。

2.  **新しいJavaScriptファイル `src/web/js/analysis.js` の作成**:
    *   ページのロード時に `/api/exchanges` から取引所リストを取得し、取引所ドロップダウンに設定。
    *   取引所ドロップダウンの変更時、選択された取引所に基づき `/api/symbols` から銘柄リストを取得し、銘柄ドロップダウンに設定。
    *   戦略の選択肢については、戦略ファイル名を取得するバックエンドAPI（新規検討）が利用可能になったら、そのAPIから取得して戦略ドロップダウンに設定。それまでは一時的に静的なリストを使用する可能性も考慮。
    *   フィルタリング条件選択後、「表示」ボタンクリック時に以下の処理を実行:
        *   `/api/ohlcv` エンドポイントからロウソク足データを取得（取引所、銘柄、時間足、期間を指定）。時間足選択UIは後で追加検討。デフォルト時間足（例: '1d'）で開始。
        *   `/api/signals` エンドポイントから戦略シグナルデータを取得（取引所、銘柄、期間を指定）。戦略名でのフィルタリングはクライアント側で行うか、バックエンドAPIの改修を検討。
        *   取得したロウソク足データと戦略シグナルデータを用いて、Chart.js でチャートを描画。ロウソク足はローソク足チャート、シグナルはオーバーレイ表示。
    *   Chart.js の設定をカスタマイズ。

3.  **ナビゲーションバーの更新**:
    *   `src/web/navbar.html` の分析ページへのコメントアウトされたリンクを有効化。

4.  **バックエンドAPIの検討（必要に応じて）**:
    *   戦略リスト取得のための新規APIエンドポイント (`/api/strategies`) の追加。
    *   `/api/signals` エンドポイントへの戦略名フィルタリング機能の追加。

## ワークフロー

```mermaid
graph TD
    A[ユーザー操作: フィルタ選択/表示ボタンクリック] --> B{analysis.js};
    B --> C[API呼び出し: /api/exchanges];
    B --> D[API呼び出し: /api/symbols];
    B --> E[API呼び出し: /api/strategies (新規検討)];
    B --> F[API呼び出し: /api/ohlcv];
    B --> G[API呼び出し: /api/signals];
    C --> H[取引所ドロップダウン更新];
    D --> I[銘柄ドロップダウン更新];
    E --> J[戦略ドロップダウン更新];
    F --> K[ロウソク足データ取得];
    G --> L[戦略シグナルデータ取得];
    K --> M[Chart.jsでロウソク足チャート描画];
    L --> M;
    M --> N[分析ページにチャート表示];

    subgraph Backend
        C --> C1[/api/exchanges];
        D --> D1[/api/symbols];
        E --> E1[/api/strategies];
        F --> F1[/api/ohlcv];
        G --> G1[/api/signals];
    end

    subgraph Frontend
        A; B; H; I; J; K; L; M; N;
    end