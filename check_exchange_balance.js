const { config } = require('./src/config');

async function checkExchangeBalance() {
  try {
    console.log('=== 取引所残高確認 ===');
    
    // 設定からbitbankのインスタンスを取得
    const exchange = config.exchanges.bitbank.instance;
    
    // 残高を取得
    const balance = await exchange.fetchBalance();
    
    console.log('\n非ゼロ残高:');
    const nonZeroBalances = Object.entries(balance.total).filter(([currency, amount]) => amount > 0);
    
    if (nonZeroBalances.length === 0) {
      console.log('非ゼロ残高はありません');
    } else {
      nonZeroBalances.forEach(([currency, amount]) => {
        console.log(`${currency}: ${amount}`);
      });
    }
    
    // ポジション関連通貨（約定済みポジションから抽出）
    const positionCurrencies = ['MASK', 'LPT', 'LINK', 'GRT'];
    console.log('\n関連通貨の残高:');
    positionCurrencies.forEach(currency => {
      const total = balance.total[currency] || 0;
      const free = balance.free[currency] || 0;
      const used = balance.used[currency] || 0;
      console.log(`${currency}: total=${total}, free=${free}, used=${used}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkExchangeBalance().catch(console.error);