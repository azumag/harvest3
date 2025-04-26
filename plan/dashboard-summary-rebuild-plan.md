### ダッシュボード取引サマリー表示機能 改修計画

**目標:**
`src/web/index.html` および `src/web/js/dashboard.js` の既存の取引サマリー表示関連UIおよびJavaScriptコードをすべて削除し、`/api/summary` から取得したデータに基づき、取引所別、戦略別、注文ペアサマリーを新しいUIで表示する。

**対象ファイル:**
- `src/web/index.html`
- `src/web/js/dashboard.js`
- `src/web/css/style.css` (必要に応じてスタイリングを追加・修正)

**計画ステップ:**

1.  **既存コードの削除:**
    *   `src/web/index.html` から、現在の取引サマリー、取引所別/戦略別サマリー、注文ペアサマリーに関連するHTMLセクション（`<div class="row mb-4">` で囲まれた部分など）をすべて削除します。
    *   `src/web/js/dashboard.js` から、取引サマリーおよびポジション表示に関連する既存のJavaScriptコード（`loadSummary`, `displayExchangeSummary`, `displayStrategySummary`, `loadOrderPairsSummary`, `displayFilteredOrderPairs`, `updateSymbolDropdown`, `groupPositionsByKey`, `displayPositionGroupContent`, `setupPositionTabListeners`, `updatePositionsPagination`, `displayPositionsPage` 関数など、および関連するグローバル変数）をすべて削除します。`initDashboard` 関数は残し、新しい初期化処理を記述します。

2.  **新しいUIのHTML構造定義:**
    *   `src/web/index.html` のメインコンテンツ領域に、新しい取引サマリー表示のためのコンテナ要素を追加します。例えば、取引所別サマリー、戦略別サマリー、注文ペアサマリーを表示するための個別の `div` 要素などです。
    *   これらのコンテナ内に、新しいUIの基本的な構造（例: カード表示のためのラッパー要素）を定義します。

3.  **新しいJavaScriptロジックの実装:**
    *   `src/web/js/dashboard.js` に、以下の新しい関数を実装します。
        *   `loadAndDisplaySummary()`: `/api/summary` エンドポイントからデータを非同期で取得する。
        *   `processSummaryData(data)`: 取得した配列データを、取引所別、戦略別、注文ペア別に整理・加工する（例: オブジェクトのキーでグループ化するなど）。
        *   `renderExchangeSummary(groupedData)`: 整理された取引所別サマリーデータを基に、動的にHTMLを生成し、対応するコンテナに表示する。
        *   `renderStrategySummary(groupedData)`: 整理された戦略別サマリーデータを基に、動的にHTMLを生成し、対応するコンテナに表示する。
        *   `renderOrderPairsSummary(data)`: 注文ペアサマリーデータを基に、動的にHTMLを生成し、対応するコンテナに表示する。
    *   `initDashboard` 関数内で、`loadAndDisplaySummary()` 関数を呼び出すように修正します。
    *   数値のフォーマットなど、必要なユーティリティ関数を新しく実装または既存のものを調整します。

4.  **スタイリングの調整:**
    *   `src/web/css/style.css` に、新しいUI要素（カード、リスト、テキストの色分けなど）のためのCSSスタイルを追加します。
    *   既存のスタイルで不要になったものを削除または修正します。

**新しいUI構成案 (Mermaid 図):**

```mermaid
graph TD
    A[ダッシュボード画面] --> B(取引サマリーセクション);
    B --> C[取引所別サマリー];
    B --> D[戦略別サマリー];
    B --> E[注文ペアサマリー];
    C --> C1(取引所1 サマリーカード/リスト);
    C --> C2(取引所2 サマリーカード/リスト);
    D --> D1(戦略1 サマリーカード/リスト);
    D --> D2(戦略2 サマリーカード/リスト);
    E --> E1(注文ペア1 カード);
    E --> E2(注文ペア2 カード);