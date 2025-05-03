# 戦略シグナルサマリー削除計画

## 背景

ユーザーからのフィードバックに基づき、ダッシュボード (`index.html`) 上の戦略シグナルサマリーセクションは不要であると判断されました。
この計画では、ダッシュボードから該当セクションを削除し、関連するコードとスタイルを整理します。
なお、シグナル履歴ページ (`signal-history.html`) は引き続き利用可能とします。

## 削除対象

-   ダッシュボード (`index.html`) 内の戦略シグナルサマリー表示エリア
-   `dashboard.js` 内の戦略シグナルサマリー関連のJavaScript関数および呼び出し
-   `style.css` 内の戦略シグナルサマリー関連のCSSスタイル

## 実施手順

```mermaid
graph TD
    A[1. index.htmlからサマリー削除] --> B(HTMLコード削除<br>Lines: 148-166)
    A --> C[2. dashboard.jsから関連コード削除]
    C --> D(loadStrategySignals呼び出し削除<br>Line: 94)
    C --> E(loadStrategySignals関数削除<br>Lines: 100-128)
    C --> F(displayStrategySignals関数削除<br>Lines: 135-226)
    C --> G(addStrategySignalStyles関数削除<br>Lines: 231-292)
    A --> H[3. style.cssから関連スタイル削除]
    H --> I(CSSルール削除<br>Lines: 273-335)
    A --> J[4. 既存計画ドキュメント更新<br>(web_ui_strategy_signal_implementation_plan.md)]
    J --> K(サマリー追加部分削除)
```

### 1. HTMLの変更 (`src/web/index.html`)

以下のコードブロックを削除します (148行目〜166行目):

```html
<!-- 戦略シグナルサマリー -->
<div class="row mb-4">
    <div class="col-12">
        <div class="card">
            <div class="card-body">
                <h5 class="card-title d-flex justify-content-between align-items-center">
                    <span>戦略シグナルサマリー</span>
                    <a href="signal-history.html" class="btn btn-sm btn-outline-primary">詳細を表示</a>
                </h5>
                <div id="strategy-signals-container">
                    <div class="text-center py-3">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">読み込み中...</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
```

### 2. JavaScriptの変更 (`src/web/js/dashboard.js`)

以下の変更を実施します:

-   `loadDashboardData` 関数内の `loadStrategySignals();` (94行目) を削除します。
-   `loadStrategySignals` 関数 (100行目〜128行目) を削除します。
-   `displayStrategySignals` 関数 (135行目〜226行目) を削除します。
-   `addStrategySignalStyles` 関数 (231行目〜292行目) を削除します。

### 3. CSSの変更 (`src/web/css/style.css`)

以下のCSSルールを削除します (273行目〜335行目):

```css
/* 戦略シグナル関連のスタイル */
.strategy-signals-grid { ... }
.signals-container { ... }
.signal-item { ... }
.signal-buy { ... }
.signal-sell { ... }
.signal-none { ... }
.signal-header, .signal-content, .signal-footer { ... }
.signal-content { ... }
.signal-symbol { ... }
.signal-exchange { ... }
.signal-icon { ... }
.signal-time { ... }
```

### 4. 既存計画ドキュメントの更新 (`plan/web_ui_strategy_signal_implementation_plan.md`)

既存の計画ドキュメントから、戦略シグナルサマリーの追加に関するセクション（「1. 戦略ごとのシグナルのサマリーをダッシュボードに追加」の部分）を削除し、この削除計画への参照を追加します。