

const { config } = require('../src/config');
const { initializeDB, listOrders, addOrderMongoDB } = require('../src/database/manager');
const { postErrorToDiscord, postOrderToDiscord } = require('../src/common/notifications');

async function reconcileOrders() {
  console.log('--- Starting Order Reconciliation ---');
  try {
    await initializeDB();

    for (const exchangeId in config.exchanges) {
      const exchange = config.exchanges[exchangeId].instance;
      console.log(`\n--- Reconciling for ${exchange.id} ---`);

      // 1. Fetch data from exchange
      const openOrders = await exchange.fetchOpenOrders();
      const recentTrades = await exchange.fetchMyTrades(undefined, Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

      console.log(`Found ${openOrders.length} open orders and ${recentTrades.length} recent trades on ${exchange.id}.`);

      // 2. Fetch data from local DB
      const dbOrders = await listOrders({ exchange: exchange.id });
      const dbOrderIds = new Set(dbOrders.map(o => o.orderId));

      // 3. Reconcile Open Orders
      let missingOpenOrders = 0;
      for (const order of openOrders) {
        if (!dbOrderIds.has(order.id)) {
          missingOpenOrders++;
          console.log(`Discrepancy: Open order ${order.id} on ${exchange.id} is missing from local DB.`);
          // In a real scenario, you might add the missing order to the DB here.
          // For now, we just report.
        }
      }

      // 4. Reconcile Recent Trades
      let missingTradeOrders = 0;
      const tradeOrderIds = new Set(recentTrades.map(t => t.order));

      for (const orderId of tradeOrderIds) {
        if (orderId && !dbOrderIds.has(orderId)) {
          missingTradeOrders++;
          console.log(`Discrepancy: Order ${orderId} from a recent trade on ${exchange.id} is missing from local DB.`);
        }
      }

      // 5. Report Summary
      const summary = `Reconciliation for ${exchange.id}:\n` +
                      `- Exchange Open Orders: ${openOrders.length}\n` +
                      `- Local DB Orders: ${dbOrders.length}\n` +
                      `- Missing Open Orders in DB: ${missingOpenOrders}\n` +
                      `- Missing Trade-related Orders in DB: ${missingTradeOrders}`;

      console.log('\n' + summary);
      await postOrderToDiscord(summary);
    }

  } catch (error) {
    console.error('An error occurred during reconciliation:', error);
    await postErrorToDiscord(`Order Reconciliation Failed: ${error.message}`);
  } finally {
    process.exit(0);
  }
}

reconcileOrders();

