# 1日取引がないHFTポジション強制決済スクリプト計画

## 目的

1日以上取引活動がないHFT戦略の未決済ポジションを強制的にリミットセル注文で決済するスクリプトを作成する。

## 参照ファイル

- `scripts/tmpMKRClean.js`: createLimitSellOrderの使用例
- `scripts/mergeOutsideToHft.js`: 戦略サマリーの取得方法、サマリー構造

## 計画ステップ

1.  必要なモジュールのインポート:
    *   取引所オブジェクト (`../src/config`)
    *   戦略サマリー取得関数 (`../src/database/manager`)
    *   時間計算のためのライブラリ (例: `moment` または標準の `Date`)
    *   Redisクライアント関連 (`../src/redisClient`) - 必要に応じて
2.  メイン関数 `main` の作成。
3.  `main` 関数内で、設定されているすべての取引所に対して以下の処理を繰り返す。
4.  `getTradeSummaries(exchange.id)` を使用して、その取引所のすべての戦略サマリーを取得する。
5.  取得したサマリーリストをループ処理する。
6.  各サマリーが以下の条件を満たすか確認する。
    *   `strategyKey` が 'HFT' であること。
    *   `netPosition` が 0 でないこと。
    *   `updatedAt` から現在までの経過時間が1日（24時間）以上であること。
7.  条件を満たすサマリーが見つかった場合、そのサマリーの `symbol` と `netPosition` を取得する。
8.  取引所オブジェクトの `fetchTicker(symbol)` メソッドを使用して、現在の価格（lastTicker）を取得する。
9.  取得した `netPosition` を数量、`fetchTicker` で取得した価格を指値として、取引所オブジェクトの `createLimitSellOrder(symbol, netPosition, price, { postOnly: true })` を使用してリミットセル注文を発注する。
10. 数秒待機する (例: `await sleep(5000)`)。
11. 取引所オブジェクトの `fetchOpenOrders(symbol)` を使用して、発注した注文が約定せずに残っているか確認する。
12. 注文がキャンセルされていた場合（`fetchOpenOrders` の結果に注文IDが含まれていない場合）、ログを出力して通知する。
13. 処理の最後に、必要に応じてRedisクライアントの終了処理を行う。

## 処理フロー (Mermaid)

```mermaid
graph TD
    A[スクリプト開始] --> B{取引所ループ};
    B --> C[getTradeSummariesでサマリー取得];
    C --> D{サマリーリストループ};
    D --> E{HFT戦略か?};
    E -- Yes --> F{netPosition != 0?};
    F -- Yes --> G{updatedAtから1日経過?};
    G -- Yes --> H[fetchTickerで価格取得];
    H --> I[createLimitSellOrderで注文発注];
    I --> J[数秒待機];
    J --> K[fetchOpenOrdersで注文確認];
    K --> L{注文が存在するか?};
    L -- Yes --> M[処理完了];
    L -- No --> N[リトライまたはログ出力];
    N --> M;
    G -- No --> D;
    F -- No --> D;
    E -- No --> D;
    D --> B;
    B --> O[スクリプト終了];