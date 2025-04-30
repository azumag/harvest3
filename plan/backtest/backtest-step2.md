バックテスト対応関数の整備(part2)

### exchange.fetchBalance
manager.js に getAvailableFund を作成
既存の exchange.fetchBalance を置き換え
*   **ロジック:**
    *   `options.backtest` が `null` でない場合:
        * basefund - buycost + sellCost を返す
    *   `options.backtest` および options が未定義の場合:
        *   既存の fetchBalance 呼び出し, availableFunds を手に入れて整形

### getRealizedPnL
*   **ロジック:**
    *   `options.backtest` が `null` でない場合:
        * sellCost - buyCost を返す
    *   `options.backtest` および options が未定義の場合:
        *   既存の fetchBalance 呼び出し, availableFunds を手に入れて整形

### checkBuyOrderAllowance
*   **ロジック:**
    *   `options.backtest` が `null` でない場合:
        *   lastsignal が 'sell' なら true, 'buy' なら false

### exchange.createLimitBuyOrder
*   `options.backtest` が `null` でない場合:
    *   ランダムなorderIDを返す

### addOrder
*   lastSignalをパラメータのsideで上書き
*   amount を更新
*   currentPrice * amount で buy/sell Cost を上書き

### formattedAvailableAmount
*   lastSignal=buy なら amount を返す
*   sellなら0





