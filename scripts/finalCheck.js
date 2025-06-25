const { getAllTradeSummaries } = require("../src/database/redisDatabase");
const { initRedisClient } = require("../src/database/redisClient");
const { config } = require("../src/config");

async function finalCheck() {
  console.log("🎯 FINAL BALANCE VERIFICATION - POST PHANTOM ELIMINATION");
  console.log("========================================================");
  
  try {
    await initRedisClient();
    
    // Get current bot positions
    const summaries = await getAllTradeSummaries();
    console.log("Remaining trade summaries:", summaries.length);
    
    const botPositions = {};
    let totalBotValue = 0;
    
    for (const summary of summaries) {
      const { symbol, netPosition } = summary;
      if (netPosition && Math.abs(netPosition) > 0.0001) {
        const currency = symbol.split("/")[0];
        if (!botPositions[currency]) botPositions[currency] = 0;
        botPositions[currency] += parseFloat(netPosition);
        totalBotValue += Math.abs(netPosition);
      }
    }
    
    console.log("\n📊 CURRENT BOT POSITIONS:");
    console.log("=========================");
    for (const [currency, amount] of Object.entries(botPositions)) {
      console.log(currency + ":", amount.toFixed(6));
    }
    console.log("Total bot value:", totalBotValue.toFixed(6));
    
    // Get exchange balances
    const actualBalances = {};
    let totalExchangeValue = 0;
    
    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (exchangeConfig && exchangeConfig.instance) {
        try {
          const balance = await exchangeConfig.instance.fetchBalance();
          console.log("\n📊 EXCHANGE BALANCES (" + exchangeId + "):");
          console.log("=========================");
          
          for (const [currency, amount] of Object.entries(balance.total || {})) {
            if (amount > 0.0001 && currency !== "JPY") {
              actualBalances[currency] = amount;
              totalExchangeValue += amount;
              console.log(currency + ":", amount.toFixed(6));
            }
          }
        } catch (error) {
          console.error("Balance fetch error:", error.message);
        }
      }
    }
    
    console.log("Total exchange value:", totalExchangeValue.toFixed(6));
    
    // Calculate final discrepancy
    const finalDiscrepancy = Math.abs(totalBotValue - totalExchangeValue);
    const discrepancyPercentage = totalExchangeValue > 0 ? (finalDiscrepancy / totalExchangeValue * 100) : 0;
    
    console.log("\n🎯 FINAL RECONCILIATION:");
    console.log("========================");
    console.log("Bot managed value:", totalBotValue.toFixed(6));
    console.log("Exchange actual value:", totalExchangeValue.toFixed(6));
    console.log("Final discrepancy:", finalDiscrepancy.toFixed(6));
    console.log("Discrepancy percentage:", discrepancyPercentage.toFixed(2) + "%");
    
    const success = finalDiscrepancy < 50 && discrepancyPercentage < 5;
    
    console.log("\n" + (success ? "✅ FINAL VERIFICATION: SUCCESS" : "❌ FINAL VERIFICATION: FAILED"));
    console.log("Status:", success ? "System synchronized" : "Further intervention needed");
    
    // Currency comparison
    console.log("\n🔍 CURRENCY-BY-CURRENCY VERIFICATION:");
    console.log("=====================================");
    
    const allCurrencies = new Set([...Object.keys(botPositions), ...Object.keys(actualBalances)]);
    let matchedCurrencies = 0;
    
    for (const currency of allCurrencies) {
      const botAmount = botPositions[currency] || 0;
      const exchangeAmount = actualBalances[currency] || 0;
      const diff = Math.abs(botAmount - exchangeAmount);
      
      if (diff < 0.1) {
        console.log("✅", currency + ":", "SYNCHRONIZED (diff:", diff.toFixed(6) + ")");
        matchedCurrencies++;
      } else {
        console.log("⚠️", currency + ":", "Bot=" + botAmount.toFixed(6), "Exchange=" + exchangeAmount.toFixed(6), "Diff=" + diff.toFixed(6));
      }
    }
    
    console.log("\nSynchronized currencies:", matchedCurrencies + "/" + allCurrencies.size);
    
    return {
      success,
      totalBotValue,
      totalExchangeValue,
      finalDiscrepancy,
      discrepancyPercentage,
      synchronizedCurrencies: matchedCurrencies,
      totalCurrencies: allCurrencies.size,
      remainingPositions: summaries.length
    };
    
  } catch (error) {
    console.error("Final balance check error:", error);
    throw error;
  }
}

finalCheck().catch(console.error);
