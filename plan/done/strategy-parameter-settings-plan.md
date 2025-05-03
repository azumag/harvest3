# 戦略パラメータ設定ページ改修計画

## 概要

戦略パラメータ設定ページ (`src/web/js/parameter-settings.js`) において、現在の取引所、銘柄、戦略を順次取得してからパラメータを取得する方法から、全パラメータを一括で取得する方法に変更する。
そのために、`src/database/redisDatabase.js` に全パラメータ一括取得関数を作成し、`src/database/manager.js` を経由してフロントエンドから利用できるようにする。
また、取得したパラメータのキー名 (`params:取引所ID:銘柄:戦略キー`) から取引所ID、銘柄、戦略キーを抽出する処理を実装する。

## 計画ステップ

1.  **`src/database/redisDatabase.js` に全パラメータ取得関数を作成:**
    *   Redisから `params:*` のパターンで全てのパラメータキーを取得します。
    *   取得した各キーに対応するパラメータをRedisから取得し、キーとパラメータのペアのリストまたはオブジェクトとして返します。
    *   関数名を `getAllStrategyParametersRedis` とする。

2.  **`src/database/manager.js` に新しい関数を追加:**
    *   `redisDatabase` で作成した全パラメータ取得関数 (`getAllStrategyParametersRedis`) をインポートします。
    *   その関数を呼び出す新しい関数 (`getAllStrategyParameters`) を `manager.js` に作成し、エクスポートします。これにより、データベースアクセスが一元管理されます。

3.  **APIエンドポイントの追加/修正:**
    *   `src/web/js/parameter-settings.js` からバックエンドのデータベース関数を直接呼び出すことはできないため、全パラメータを取得するための新しいAPIエンドポイントを作成します。
    *   `src/api/routes.js` に新しいGETエンドポイント（例: `/api/all-parameters`）を追加します。
    *   `src/api/controllers/parameters.js` に新しいコントローラー関数を作成し、その中で `manager.js` の新しい全パラメータ取得関数 (`getAllStrategyParameters`) を呼び出し、結果をJSON形式で返します。

4.  **`src/web/js/parameter-settings.js` の修正:**
    *   `loadAllParameters` 関数内の、取引所、銘柄、戦略を順次取得し、各パラメータを個別にfetchしている既存の処理を削除またはコメントアウトします。
    *   新しく作成したAPIエンドポイント（`/api/all-parameters`）をfetchして、全パラメータデータを一括で取得します。
    *   取得したデータはキー（例: `params:bitflyer:ETH/BTC:OSCILLATOR_LONG`）とパラメータオブジェクトのマップ形式になっていると想定されます。
    *   取得したデータの各キーを `:` で分割し、取引所ID、銘柄、戦略キーを抽出します。
    *   抽出した取引所ID、銘柄、戦略キー、および対応するパラメータオブジェクトを `displayParameterForm` 関数に渡して、画面に表示します。
    *   エラーハンドリングを適切に実装します。

## 計画フロー

```mermaid
graph TD
    A[ユーザー要求: パラメータ一括取得] --> B[計画立案];

    B --> C[ステップ1: redisDatabase.js修正];
    C --> C1[getAllStrategyParametersRedis関数作成];
    C1 --> C2[client.keys('params:*')でキー取得];
    C2 --> C3[各キーでhGetAll実行];
    C3 --> C4[キーとパラメータのマップを返す];
    C4 --> C5[getAllStrategyParametersRedisをエクスポート];

    B --> D[ステップ2: manager.js修正];
    D --> D1[redisDatabaseから新関数インポート];
    D1 --> D2[getAllStrategyParameters関数作成];
    D2 --> D3[redisDatabaseの新関数を呼び出す];
    D3 --> D4[getAllStrategyParametersをエクスポート];

    B --> E[ステップ3: APIエンドpoint追加/修正];
    E --> E1[src/api/routes.jsにGET /api/all-parameters追加];
    E1 --> E2[src/api/controllers/parameters.jsに新コントローラー作成];
    E2 --> E3[コントローラーでmanager.getAllStrategyParameters呼び出し];
    E3 --> E4[結果をJSONで返す];

    B --> F[ステップ4: parameter-settings.js修正];
    F --> F1[loadAllParameters関数修正];
    F1 --> F2[取引所/戦略取得部分削除];
    F2 --> F3[新API /api/all-parameters をfetch];
    F3 --> F4[取得データ（キーとパラメータ）をループ];
    F4 --> F5[キーを':'で分割し、exchangeId, symbol, strategyKey抽出];
    F5 --> F6[displayParameterFormを呼び出し];
    F6 --> F7[エラーハンドリング];

    B --> G[ステップ5: 計画提示];
    G --> H{ユーザー承認};
    H -- はい --> I[ステップ6: コード実装];
    I --> J[ステップ7: 完了報告];
    H -- いいえ --> B;