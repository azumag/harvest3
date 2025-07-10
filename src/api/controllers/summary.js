/**
 *取引の集計サマリーを取得するコントローラー
 */
const { getAllTradeSummaries, getAvailableFund, getMarketParameters } = require('../../database/manager');
const marketDataProvider = require('../../data/marketDataProvider');
const { config } = require('../../config');

/**
 * 取引の集計サマリーを取得するコントローラー
 *
 */
async function getTradeSummary(req, res) {
  try {
    // サマリー情報を取得
    const summaryData = await getAllTradeSummaries();

    // 緊急対応：calculateAvailableAmountsを一時的に無効化
    // const availableAmounts = await calculateAvailableAmounts(summaryData);

    // サマリーデータがオブジェクトか配列かを判定
    let enhancedSummaryData;
    if (Array.isArray(summaryData)) {
      // 配列の場合はオブジェクトでラップ
      enhancedSummaryData = {
        positions: summaryData
        // availableAmounts  // 一時的にコメントアウト
      };
    } else {
      // オブジェクトの場合はそのまま返す
      enhancedSummaryData = {
        ...summaryData
        // availableAmounts  // 一時的にコメントアウト
      };
    }

    // 結果をJSON形式で返す
    res.json(enhancedSummaryData);
  } catch (error) {
    console.error('サマリー情報取得エラー:', error);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
}

/**
 * 各通貨ペアの購入可能額を計算
 * @param {Array|Object} summaryData - 事前に取得されたサマリーデータ
 */
async function calculateAvailableAmounts(_summaryData) {
  try {
    const availableAmounts = {};
    // configからbitbankインスタンスを使用
    const exchange = config.exchanges.bitbank.instance;

    // 残高情報を一度だけ取得
    const balance = await getAvailableFund(exchange, '', {});

    // 戦略別の実現損益を取得（引数として受け取ったサマリーデータから）
    const strategyPnLMap = {};

    // summaryDataが配列の場合とオブジェクトの場合の両方に対応
    const positions = Array.isArray(_summaryData) ? _summaryData : _summaryData.positions;

    // 戦略・通貨ペアごとの実現損益をマップに格納
    if (positions && Array.isArray(positions)) {
      positions.forEach(position => {
        const strategyName = position.strategyKey || position.strategy_name;
        const key = `${strategyName}_${position.symbol}`;
        strategyPnLMap[key] = position.realizedPnL || position.realized_pnl || 0;
      });
    }

    // summaryDataのpositionsから実際に使用されている戦略・通貨ペアの組み合わせを取得
    const strategySymbolMap = {};

    if (positions && Array.isArray(positions) && positions.length > 0) {
      positions.forEach(position => {
        const strategyName = position.strategyKey || position.strategy_name;
        const symbol = position.symbol;

        if (!strategySymbolMap[strategyName]) {
          strategySymbolMap[strategyName] = {};
        }

        // デフォルトのtradePercentageを設定（実際の値は戦略設定から取得するか、デフォルト値を使用）
        strategySymbolMap[strategyName][symbol] = {
          tradePercentage: config.global?.tradePercentage || 0.01
        };
      });
    }

    // 戦略別に購入可能額を計算（レート制限を考慮した最適化）
    for (const [strategyName, symbols] of Object.entries(strategySymbolMap)) {
      availableAmounts[strategyName] = {};

      // 戦略内のシンボルを順次処理（レート制限対策）
      for (const [symbol, symbolConfig] of Object.entries(symbols)) {
        try {
          const baseCurrency = symbol.split('/')[1];
          const quoteCurrency = symbol.split('/')[0];
          const availableFunds = balance.free[baseCurrency] || 0;

          // ticker取得とmarketParams取得を並列実行（同一シンボルなのでレート制限に問題なし）
          const [ticker, marketParams] = await Promise.all([
            marketDataProvider.fetchTicker(exchange, symbol),
            getMarketParameters(exchange, symbol)
          ]);

          const currentPrice = ticker.last;
          const { amountPrecision, minTradeAmount } = marketParams;

          // 戦略の実現損益を取得
          const strategyKey = `${strategyName}_${symbol}`;
          const realizedPnL = strategyPnLMap[strategyKey] || 0;

          // tradePercentageを取得
          const tradePercentage = symbolConfig.tradePercentage || 0.1;

          // executeBuyOrderと同じ計算式を使用
          const maxBuyAmount = ((availableFunds * tradePercentage) + realizedPnL) / currentPrice;

          // 最小取引量を考慮
          const tradeAmount = Math.max(minTradeAmount || 0, maxBuyAmount);
          let formattedAmount = parseFloat(tradeAmount.toFixed(amountPrecision || 8));
          formattedAmount = Math.max(formattedAmount, 0.0001);

          availableAmounts[strategyName][symbol] = {
            baseCurrency,
            quoteCurrency,
            availableFunds,
            currentPrice,
            realizedPnL,
            tradePercentage: tradePercentage * 100,
            availableAmount: formattedAmount,
            availableValue: formattedAmount * currentPrice,
            // 実現損益を含めた合計購入可能額
            totalAvailableValue: (availableFunds * tradePercentage) + realizedPnL,
            minTradeAmount,
            amountPrecision
          };
        } catch (error) {
          console.error(`Error calculating available amount for ${strategyName}/${symbol}:`, error.message);
          availableAmounts[strategyName][symbol] = {
            error: error.message
          };
        }
      }
    }

    return availableAmounts;
  } catch (error) {
    console.error('Error calculating available amounts:', error);
    return {};
  }
}

module.exports = {
  getTradeSummary
};