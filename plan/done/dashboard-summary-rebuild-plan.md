# ダッシュボード サマリー表示UI再構築計画

## 目的

`src/web/index.html` に、取引所、銘柄、戦略ごとにタブでドリルダウンできるようなサマリー表示UIを追加する。

## 現状分析

*   `src/web/index.html` には既存の取引サマリーセクションが存在する。
*   `src/web/js/dashboard.js` は、API (`/api/trade-summary`) からサマリーデータを取得し、取引所別、戦略別、注文ペア別に表示するロジックを持つ。
*   `src/web/css/style.css` には、既存のサマリー表示に関するスタイルが含まれる。
*   API `/api/trade-summary` は、取引所、戦略、注文ペアごとのサマリーデータを提供しており、これを活用してフロントエンドで銘柄別の集計も可能と判断。

## 計画概要

1.  `src/web/index.html` にBootstrapのタブコンポーネントを導入し、「取引所」「銘柄」「戦略」の3つのタブ構造を作成する。
2.  `src/web/js/dashboard.js` を修正し、APIから取得したデータから銘柄別のサマリーを集計するロジックを追加する。
3.  各タブが選択された際に、対応する取引所別、銘柄別、戦略別のサマリーを表示するJavaScript関数を実装する。
4.  `src/web/css/style.css` に、新しいタブ表示のためのスタイルを追加・調整する。

## 詳細計画

1.  **HTML (`src/web/index.html`) の変更:**
    *   既存の取引サマリーセクション (`#summary-container`) 内に、BootstrapのNavs and Tabs構造を追加します。
    *   タブヘッダー (`nav nav-tabs`) に「取引所」「銘柄」「戦略」のリンク (`nav-link`) を配置します。
    *   タブコンテンツ (`tab-content`) に、各タブに対応するペイン (`tab-pane`) を作成します。それぞれのペイン内に、サマリーを表示するためのコンテナ (`#exchange-summary-pane`, `#symbol-summary-pane`, `#strategy-summary-pane`) を設けます。
    *   既存のローディング表示 (`#summary-loading`) は、タブ構造の外に配置するか、各タブペイン内に移動します。

2.  **JavaScript (`src/web/js/dashboard.js`) の修正:**
    *   `loadAndDisplaySummary` 関数内でAPIからデータを取得後、`processSummaryData` 関数を呼び出します。
    *   `processSummaryData` 関数に、`orderPairs` データから銘柄別のサマリー（買った額、売った額、手数料、実現損益、純損益）を集計する処理を追加し、結果を返り値に含めます。
    *   新しい関数 `renderSymbolSummary(symbolData)` を作成し、銘柄別のサマリーデータをカード形式で `#symbol-summary-pane` に表示するロジックを実装します。
    *   Bootstrapのタブ切り替えイベントをリッスンし、タブが切り替わった際に、対応するレンダリング関数 (`renderExchangeSummary`, `renderSymbolSummary`, `renderStrategySummary`) を呼び出します。データは既に取得・集計済みのものを使用します。
    *   既存の `renderExchangeSummary` および `renderStrategySummary` 関数は、新しいコンテナID (`#exchange-summary-pane`, `#strategy-summary-pane`) を対象とするように修正します。

3.  **CSS (`src/web/css/style.css`) の修正:**
    *   Bootstrapのタブコンポーネントが適切に表示されるように、必要に応じてスタイルを追加または調整します。
    *   各タブペイン内のサマリーカードが適切にレイアウトされるように、既存の `.summary-cards` などのスタイルを調整します。

## ワークフロー

```mermaid
graph TD
    A[ユーザー要求: サマリー表示UIの改善] --> B{情報収集};
    B --> C[src/web/index.html 内容確認];
    B --> D[src/web/js/dashboard.js 内容確認];
    B --> E[src/web/css/style.css 内容確認];
    B --> F{ユーザーへの質問};
    F --> G[タブ構造の確認];
    F --> H[表示サマリーレベルの確認];
    G --> I[回答: タブフィルタリングUI];
    H --> J[回答: 取引所, 銘柄, 戦略レベル];
    C & D & E & I & J --> K[計画立案];
    K --> L[計画: HTML構造変更];
    K --> M[計画: JSロジック修正/追加];
    K --> N[計画: CSSスタイル調整];
    L & M & N --> O[ユーザーに計画提示];
    O --> P{計画承認};
    P -- はい --> Q[実装モードへ切り替え];
    P -- いいえ --> K;