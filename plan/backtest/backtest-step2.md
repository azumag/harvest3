## バックテスト対応関数の整備 (part2) 実装計画

`plan/backtest/backtest-step2.md` の内容に基づき、バックテスト対応のための関数整備を以下の計画で実施します。

### 1. `src/database/manager.js` の修正・追加

-   **`getAvailableFund` 関数の新規追加:**
    -   引数: `exchange`, `symbol`, `options`, `basefund`, `buycost`, `sellcost`
    -   ロジック:
        -   `options.backtest` が存在する場合: `basefund - buycost + sellcost` を計算して返す。
        -   `options.backtest` が存在しない場合 (リアルタイムモード): 既存の `exchange.fetchBalance` を呼び出し、利用可能な資金を取得して整形して返す。
    -   `module.exports` に `getAvailableFund` を追加。

-   **`getRealizedPnL` 関数の修正:**
    -   引数: `exchange`, `symbol`, `strategyKey`, `options` (options を追加)
    -   ロジック:
        -   `options.backtest` が存在する場合: `options.backtest.totalSellCost - options.backtest.totalBuyCost` を計算して返す。
        -   `options.backtest` が存在しない場合 (リアルタイムモード): 既存のロジック (`updateFilledTrades` を呼び出し、サマリーから `realizedPnL` を取得) を実行。

-   **`addOrder` 関数の修正:**
    -   引数: `exchange`, `symbol`, `strategyKey`, `side`, `amount`, `price`, `orderId`, `orderType`, `options` (options を追加)
    -   ロジック:
        -   `options.backtest` が存在する場合:
            -   `options.backtest.lastSignal` をパラメータの `side` で上書き。
            -   `options.backtest.currentAmount` をパラメータの `amount` で上書き。
            -   `side` が 'buy' の場合: `options.backtest.totalBuyCost` に `price * amount` を加算。
            -   `side` が 'sell' の場合: `options.backtest.totalSellCost` に `price * amount` を加算。
        -   `options.backtest` が存在しない場合 (リアルタイムモード): 既存のロジック (`addOrderMongoDB` を呼び出し、注文をDBに記録) を実行。

-   **`formattedAvailableAmount` 関数の修正:**
    -   引数: `exchange`, `symbol`, `strategyKey`, `amountPrecision`, `options` (options を追加)
    -   ロジック:
        -   `options.backtest` が存在する場合:
            -   `options.backtest.lastSignal` が 'buy' なら `options.backtest.currentAmount` を返す。
            -   `options.backtest.lastSignal` が 'sell' なら 0 を返す。
        -   `options.backtest` が存在しない場合 (リアルタイムモード): 既存のロジック (ネットポジションと未約定売り注文量から計算) を実行。

-   **バックテスト用注文関数 (`backtestCreateLimitBuyOrder`, `backtestCreateLimitSellOrder`) の新規追加:**
    -   関数名: `backtestCreateLimitBuyOrder`, `backtestCreateLimitSellOrder`
    -   引数: `symbol`, `amount`, `price`, `options` (`@/src/strategies/utils/common.js` の `executeBuyOrder` / `executeSellOrder` を参考に、必要な引数を調整します)
    -   ロジック: ランダムな文字列を生成し、`{ id: '生成したランダム文字列' }` の形式で返す。
    -   `module.exports` にこれらの関数を追加。

### 2. `src/common/utils.js` の修正

-   **`checkBuyOrderAllowance` 関数の修正:**
    -   引数: 既存の引数に加えて `options` を追加。
    -   ロジック:
        -   `options.backtest` が存在する場合: `options.backtest.lastsignal` が 'sell' なら `true`、'buy' なら `false` を含むオブジェクト `{ allowed: boolean, reason: string }` を返す。
        -   `options.backtest` が存在しない場合 (リアルタイムモード): 既存のロジックを実行。

### 3. `src/strategies/utils/common.js` の修正

-   **`executeBuyOrder` 関数の修正:**
    -   `exchange.fetchBalance()` の呼び出しを `src/database/manager.js` の `getAvailableFund` の呼び出しに置き換える。その際、`options.backtest` が存在する場合は必要な引数 (`basefund`, `buycost`, `sellcost`) を渡す必要があります。これらの値はバックテストのメインループで管理されるため、`executeBuyOrder` にも引数として渡すか、`options.backtest` に含めて渡すことを検討します。
    -   `exchange.createLimitBuyOrder` の呼び出し箇所で、`options.backtest` が存在する場合は、`src/database/manager.js` に新設した `backtestCreateLimitBuyOrder` を呼び出すように分岐を追加。

-   **`executeSellOrder` 関数の修正:**
    -   `exchange.fetchBalance()` の呼び出しを `src/database/manager.js` の `getAvailableFund` の呼び出しに置き換える。（※上記 `executeBuyOrder` と同様、引数の調整が必要です。）
    -   `exchange.createLimitSellOrder` の呼び出し箇所で、`options.backtest` が存在する場合は、`src/database/manager.js` に新設した `backtestCreateLimitSellOrder` を呼び出すように分岐を追加。

### 4. バックテストのメインループ (新規作成または既存の修正)

-   バックテストのメインループを実装するファイル (例: 新規ファイル `src/backtest/backtestRunner.js` など) を作成または修正。
-   このメインループ内で、バックテスト対象の期間、通貨ペア、戦略などを設定。
-   バックテストの各ステップで、以下の処理を実行:
    -   `options.backtest` オブジェクトを初期化または更新。このオブジェクトに `lastSignal`, `currentAmount`, `totalBuyCost`, `totalSellCost`, `availableBaseFund` などのプロパティを持たせ、シミュレーションの進行に合わせてこれらの値を更新する。
    -   OHLCV データを取得し、現在の価格を取得。
    -   戦略のシグナルを計算。
    -   シグナルに基づき、修正した関数群 (`getAvailableFund`, `getRealizedPnL`, `checkBuyOrderAllowance`, `addOrder`, `formattedAvailableAmount`、およびバックテスト用の注文関数を呼び出す `executeBuyOrder`, `executeSellOrder`) を、`options` オブジェクトを渡して呼び出す。
    -   各関数の実行結果に基づいて、`options.backtest` オブジェクト内のバックテスト関連データを更新。

### 補足

-   `options.backtest` オブジェクトの具体的な構造や、バックテストメインループでのデータの管理・更新ロジックは、バックテストの実装の詳細によって調整が必要です。
-   既存のテストコードや、これらの関数を呼び出している他の箇所についても、バックテストモードに対応するための修正が必要になる場合があります。
