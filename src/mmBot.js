const { exchangeBB, exchangeBF, bitflyerMinTradeAmounts } = require('./config');
const { config } = require('./config');
const { postErrorToDiscord, postOrderToDiscord } = require('./common/notifications');
const { runStrategy } = require('./strategyRunner');
const { getMarketParameters, sleep } = require('./utils');

// ... ここに既存のコード ...

module.exports = {
  // ... ここにエクスポートするもの ...
};