const { config } = require('../src/config');
const { saveStrategyParameters, initialize } = require('../src/redisDatabase');

async function populateStrategyParameters() {
  await initialize(); // Redisクライアントを初期化

  console.log('Initializing strategy parameters in Redis...');

  // 共通パラメータを保存
  const commonParams = {
    amount: config.amount,
    profitMargin: config.profitMargin,
    maxHistoryLength: config.maxHistoryLength,
    tradePercentage: config.tradePercentage,
    sellPercentage: config.sellPercentage,
    tradeCost: config.tradeCost,
    cancelOrderThreshold: config.cancelOrderThreshold,
    safetyJPYAmount: config.safetyJPYAmount,
    amountPrecision: config.amountPrecision,
  };
  // 共通パラメータは 'global:all:common' という汎用キーで保存
  await saveStrategyParameters('global', 'all', 'common', commonParams);
  console.log('Common parameters saved.');

  // 各戦略のパラメータを保存
  for (const strategyKey in config.strategies) {
    if (config.strategies.hasOwnProperty(strategyKey)) {
      const strategyParams = config.strategies[strategyKey];
      // 各戦略のパラメータは 'global:all:<strategyKey>' という汎用キーで保存
      await saveStrategyParameters('global', 'all', strategyKey, strategyParams);
      console.log(`Parameters for strategy ${strategyKey} saved.`);
    }
  }

  console.log('Strategy parameter initialization complete.');
  process.exit(0); // スクリプト終了
}

populateStrategyParameters().catch(error => {
  console.error('Error initializing strategy parameters:', error);
  process.exit(1); // エラー終了
});