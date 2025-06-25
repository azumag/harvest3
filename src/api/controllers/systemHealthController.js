
/**
 * システムヘルスダッシュボードAPIコントローラー
 */
const { checkAllExchangeBalances } = require('../../common/balanceChecker');
const { getAllPendingOrdersRedis } = require('../../database/redisDatabase');
const { config } = require('../../config');

async function getSystemHealth(req, res) {
  try {
    const healthData = {
      timestamp: Date.now(),
      overallStatus: "HEALTHY", // Default to HEALTHY
      keyMetrics: {
        balanceDiscrepancies: 0,
        untrackedPositions: 0, // Placeholder for future implementation
        ghostPositions: 0,     // Placeholder for future implementation
        pendingOrders: 0,
        activeStrategies: 0
      },
      componentStatus: [
        // This will be populated by the checks below
      ],
      recentAlerts: [] // Placeholder for future implementation
    };

    // 1. Balance Consistency Check
    const balanceResults = await checkAllExchangeBalances();
    const discrepancies = balanceResults.reduce((acc, result) => acc + (result.discrepancies ? result.discrepancies.length : 0), 0);
    healthData.keyMetrics.balanceDiscrepancies = discrepancies;
    healthData.componentStatus.push({
      name: "Balance Consistency",
      status: discrepancies > 5 ? "CRITICAL" : discrepancies > 0 ? "WARNING" : "HEALTHY",
      details: `${discrepancies}件の不整合を検出`
    });

    // 2. Pending Orders Check
    const pendingOrders = await getAllPendingOrdersRedis();
    healthData.keyMetrics.pendingOrders = pendingOrders.length;
    let pendingStatus = "HEALTHY";
    if (pendingOrders.length > 100) pendingStatus = "CRITICAL";
    else if (pendingOrders.length > 50) pendingStatus = "WARNING";
    healthData.componentStatus.push({
      name: "Order Lifecycle Tracking",
      status: pendingStatus,
      details: `未約定注文: ${pendingOrders.length}件`
    });

    // 3. Active Strategies Count
    healthData.keyMetrics.activeStrategies = Object.values(config.strategies).filter(s => s.enabled).length;

    // 4. Determine Overall Status
    const hasCritical = healthData.componentStatus.some(c => c.status === "CRITICAL");
    const hasWarning = healthData.componentStatus.some(c => c.status === "WARNING");

    if (hasCritical) {
      healthData.overallStatus = "CRITICAL";
    } else if (hasWarning) {
      healthData.overallStatus = "WARNING";
    }

    res.json(healthData);

  } catch (error) {
    console.error('System health check failed:', error);
    res.status(500).json({
      timestamp: Date.now(),
      overallStatus: "ERROR",
      error: "Failed to retrieve system health",
      details: error.message
    });
  }
}

module.exports = {
  getSystemHealth
};
