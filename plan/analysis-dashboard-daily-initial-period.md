# 分析とダッシュボードページの期間指定を日次に

## タスク概要

分析とダッシュボードページで、最初に表示される期間指定を日次に設定する。

## 詳細

*   分析ページとダッシュボードページの両方を同時に変更する。
*   期間指定の初期値を設定する方法は特に指定がないため、最適な方法を選択する。
*   「日次」の期間指定は過去24時間を指す。

## 計画

1.  `src/web/js/analysis.js`と`src/web/js/dashboard.js`で、期間指定の初期値を設定するコードを見つける。
2.  JavaScriptで初期値を設定する。具体的には、select要素のvalue属性を「daily」に設定するか、対応する処理で「daily」が選択された状態にする。
3.  `src/web/js/analysis.js`と`src/web/js/dashboard.js`で、「日次」の期間指定が過去24時間を指すように、必要に応じて期間計算のロジックを修正する。
4.  変更をテストし、意図した通りに動作することを確認する。

## Mermaid図

```mermaid
graph LR
    A[タスク: 分析とダッシュボードページの期間指定を日次に] --> B{情報収集};
    B --> C[ファイル調査: analysis.html, analysis.js, dashboard.html, dashboard.js];
    B --> D[「日次」の範囲 = 過去24時間];
    C --> H{変更計画};
    D --> H;
    H --> I[コード変更: analysis.js, dashboard.js];
    I --> J[テスト];
    J --> K[完了];