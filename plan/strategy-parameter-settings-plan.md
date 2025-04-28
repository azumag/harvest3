# 戦略パラメータ設定ページ実装計画

## 概要

本計画は、取引戦略のパラメータをウェブUIから設定・更新できるページを`src/web`配下に追加することを目的とする。バックエンドは既存の`src/database/manager.js`の関数を利用し、パラメータの取得と更新を行うAPIエンドポイントを新規に実装する。フロントエンドは、銘柄別および戦略別のタブ切り替えUIを持つページを新規に作成し、パラメータの表示・編集機能を提供する。

## 計画詳細

1.  **バックエンドAPIの実装:**
    *   `src/api/controllers/parameters.js` を新規作成し、戦略パラメータの取得および保存のためのAPIエンドポイントのロジックを実装する。
    *   `src/database/manager.js` の `getStrategyParameters` および `saveStrategyParameters` 関数を利用する。
    *   パラメータ取得API (`GET /api/parameters`) は、クエリパラメータとして `exchangeId`, `symbol`, `strategyKey` を受け取り、対応するパラメータをJSON形式で返却する。
    *   パラメータ更新API (`POST /api/parameters`) は、リクエストボディとして `exchangeId`, `symbol`, `strategyKey`, および更新するパラメータオブジェクトを受け取り、`saveStrategyParameters` を呼び出す。
    *   `src/api/routes.js` に、パラメータ取得 (`GET /api/parameters`) およびパラメータ更新 (`POST /api/parameters`) のルーティングを追加し、新しいコントローラ関数を紐づける。
    *   必要に応じて、取引所、銘柄、戦略のリストを取得するための既存API (`/api/exchanges`, `/api/symbols`, `/api/strategies`) を利用するか、新規にエンドポイントを作成する。

2.  **フロントエンドUIの実装:**
    *   `src/web/parameter-settings.html` を新規作成する。既存のHTMLファイル (`src/web/index.html` など) を参考に、Bootstrapを使用した基本的なページ構造とナビゲーションバーコンテナ (`#navbar-container`) を含める。
    *   ページ内に、Bootstrapのタブコンポーネントを使用して、銘柄別と戦略別のタブ切り替えUIを実装する。
    *   各タブ内に、選択された銘柄または戦略に対応するパラメータを表示・編集するためのフォームまたはテーブル構造を実装する。パラメータの構造は動的に変わる可能性があるため、取得したパラメータオブジェクトを元にフォーム要素を動的に生成するJavaScriptロジックが必要となる。
    *   パラメータの変更をローカルで保持する仕組みを実装する。
    *   パラメータの入力値を検証するクライアントサイドのバリデーションを実装する（任意）。
    *   パラメータをバックエンドに保存するためのボタンを設置する。
    *   `src/web/js/parameter-settings.js` を新規作成し、以下のロジックを実装する。
        *   ページのロード時またはユーザー操作に応じて、取引所、銘柄、戦略のリストを取得するAPIを呼び出し、UI上のドロップダウンなどを生成・更新する。
        *   銘柄または戦略の選択が変更されたら、対応するパラメータを取得するAPI (`GET /api/parameters`) を呼び出し、取得したパラメータをUIに表示する関数を呼び出す。
        *   保存ボタンのクリックイベントリスナーを設定し、現在のパラメータ設定を更新するAPI (`POST /api/parameters`) を呼び出す。
        *   API呼び出し中はローディング表示を行い、完了後には成功または失敗のフィードバックをユーザーに表示する。

3.  **ナビゲーションバーへの追加:**
    *   `src/web/navbar.html` に、新しいパラメータ設定ページ (`parameter-settings.html`) へのナビゲーションリンクを追加する。
    *   `src/web/js/navbar.js` に、新しいページにいる場合に該当ナビゲーションリンクがアクティブになるようにロジックを追加する。

## 技術スタック

*   **バックエンド:** Node.js, Express, `src/database/manager.js` (Redis/MongoDB)
*   **フロントエンド:** HTML, CSS (Bootstrap), JavaScript, Fetch API

## 想定されるUIフロー

1.  ユーザーがナビゲーションバーから「パラメータ設定」ページに遷移する。
2.  ページが表示され、取引所、銘柄、戦略を選択するためのドロップダウンが表示される。
3.  ユーザーが取引所、銘柄、戦略を選択する。
4.  選択に応じて、対応するパラメータがバックエンドから取得され、編集可能なフォームとして表示される（銘柄別タブの場合は選択した銘柄の全戦略パラメータ、戦略別タブの場合は選択した戦略の全銘柄パラメータ）。
5.  ユーザーがパラメータの値を変更する。
6.  ユーザーが「保存」ボタンをクリックする。
7.  変更されたパラメータがバックエンドに送信され、データベースに保存される。
8.  保存結果（成功/失敗）がユーザーに通知される。

## Mermaid図

```mermaid
graph TD
    A[ユーザー] --> B(ブラウザ);
    B --> C[パラメータ設定ページ表示要求];
    C --> D[src/web/parameter-settings.html];
    D --> E[src/web/js/parameter-settings.js];
    E --> F[API呼び出し: /api/parameters (GET)];
    F --> G[src/api/routes.js];
    G --> H[src/api/controllers/parameters.js];
    H --> I[src/database/manager.js::getStrategyParameters];
    I --> J[Redis/MongoDB];
    J --> I;
    I --> H;
    H --> G;
    G --> F;
    F --> E[パラメータ表示];
    E --> K[ユーザーによるパラメータ編集];
    K --> L[保存ボタンクリック];
    L --> M[API呼び出し: /api/parameters (POST)];
    M --> G[src/api/routes.js];
    G --> H[src/api/controllers/parameters.js];
    H --> N[src/database/manager.js::saveStrategyParameters];
    N --> J[Redis/MongoDB];
    J --> N;
    N --> H;
    H --> G;
    G --> M;
    M --> E[保存成功/失敗表示];

    E --> O[API呼び出し: /api/exchanges, /api/symbols, /api/strategies];
    O --> G;
    G --> P[対応するコントローラ];
    P --> Q[データベース/設定ファイル];
    Q --> P;
    P --> G;
    G --> O;
    O --> E[ドロップダウン生成];