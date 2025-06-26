const { config } = require('./src/config');

async function checkExchangeBalance() {
  try {
    console.log('=== EMERGENCY EXCHANGE BALANCE VERIFICATION ===');
    
    // 設定からbitbankのインスタンスを取得
    const exchange = config.exchanges.bitbank.instance;
    
    // 残高を取得
    const balance = await exchange.fetchBalance();
    
    console.log('\n📊 ALL NON-ZERO BALANCES (excluding JPY):');
    const nonZeroBalances = Object.entries(balance.total).filter(([currency, amount]) => amount > 0 && currency !== 'JPY');
    
    if (nonZeroBalances.length === 0) {
      console.log('❌ No non-zero balances found');
    } else {
      nonZeroBalances.forEach(([currency, amount]) => {
        const free = balance.free[currency] || 0;
        const used = balance.used[currency] || 0;
        console.log(`${currency}: TOTAL=${amount}, FREE=${free}, USED=${used}`);
      });
    }
    
    // Focus on high-variance currencies from reports
    const targetCurrencies = ['ADA', 'APE', 'DOT', 'GALA', 'XRP', 'LTC', 'BCH', 'SOL', 'XLM', 'LINK', 'MANA', 'SAND', 'CHZ', 'OAS', 'OMG', 'DOGE'];
    console.log('\n🎯 HIGH-PRIORITY CURRENCY VERIFICATION:');
    targetCurrencies.forEach(currency => {
      const total = balance.total[currency] || 0;
      const free = balance.free[currency] || 0;
      const used = balance.used[currency] || 0;
      if (total > 0) {
        console.log(`✅ ${currency}: TOTAL=${total}, FREE=${free}, USED=${used}`);
      } else {
        console.log(`❌ ${currency}: ZERO BALANCE (potential zombie position)`);
      }
    });
    
    console.log('\n✅ EXCHANGE BALANCE VERIFICATION COMPLETE');
    
  } catch (error) {
    console.error('💥 Exchange balance verification failed:', error.message);
    console.error(error.stack);
  }
}

checkExchangeBalance().catch(console.error);