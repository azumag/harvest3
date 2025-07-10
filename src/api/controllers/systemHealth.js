/**
 * システムヘルス API コントローラー - Gemini提案のPhase 3実装
 * リアルタイム監視システムのバックエンドAPI
 */

const { getAllPositionsRedis, getAllPendingOrdersRedis } = require('../../database/redisDatabase');
const { checkAllExchangeBalances } = require('../../common/balanceChecker');

/**
 * システム全体のヘルス状況を取得
 */
async function getSystemHealth(req, res) {
  try {
    // 並列でデータ取得
    const [
      positionsData,
      pendingOrdersData,
      balanceCheckData
    ] = await Promise.all([
      getPositionsHealth(),
      getPendingOrdersHealth(),
      getBalanceHealth()
    ]);

    const healthStatus = {
      timestamp: Date.now(),
      overall: calculateOverallHealth([positionsData, pendingOrdersData, balanceCheckData]),
      positions: positionsData,
      pendingOrders: pendingOrdersData,
      balance: balanceCheckData,
      system: await getSystemMetrics()
    };

    res.json(healthStatus);

  } catch (error) {
    console.error('システムヘルス取得エラー:', error);
    res.status(500).json({
      error: 'システムヘルス情報の取得に失敗しました',
      message: error.message,
      timestamp: Date.now()
    });
  }
}

/**
 * ポジション健全性の分析
 */
async function getPositionsHealth() {
  try {
    const allPositions = await getAllPositionsRedis();
    const openPositions = allPositions.filter(pos => pos.status === 'open');

    // ロング・ショートの比率計算
    const longPositions = openPositions.filter(pos => pos.side === 'buy');
    const shortPositions = openPositions.filter(pos => pos.side === 'sell');

    const longRatio = openPositions.length > 0 ? (longPositions.length / openPositions.length) * 100 : 0;

    // 健全性レベル決定
    let healthLevel = 'green';
    let healthMessage = '正常';

    if (longRatio > 90) {
      healthLevel = 'red';
      healthMessage = '極度のロング偏重';
    } else if (longRatio > 75) {
      healthLevel = 'yellow';
      healthMessage = 'ロング偏重注意';
    } else if (openPositions.length > 200) {
      healthLevel = 'red';
      healthMessage = 'ポジション数過多';
    } else if (openPositions.length > 100) {
      healthLevel = 'yellow';
      healthMessage = 'ポジション数多め';
    }

    // 通貨別分析
    const currencyBreakdown = {};
    openPositions.forEach(pos => {
      const currency = pos.symbol.split('/')[0];
      if (!currencyBreakdown[currency]) {
        currencyBreakdown[currency] = { count: 0, totalAmount: 0 };
      }
      currencyBreakdown[currency].count++;
      currencyBreakdown[currency].totalAmount += pos.amount || 0;
    });

    return {
      healthLevel,
      healthMessage,
      totalPositions: openPositions.length,
      longPositions: longPositions.length,
      shortPositions: shortPositions.length,
      longRatio: Math.round(longRatio * 100) / 100,
      currencyBreakdown,
      lastUpdated: Date.now()
    };

  } catch (error) {
    console.error('ポジション健全性分析エラー:', error);
    return {
      healthLevel: 'red',
      healthMessage: 'データ取得エラー',
      error: error.message,
      lastUpdated: Date.now()
    };
  }
}

/**
 * 未約定注文健全性の分析
 */
async function getPendingOrdersHealth() {
  try {
    const pendingOrders = await getAllPendingOrdersRedis();

    // 買い・売り注文の分析
    const buyOrders = pendingOrders.filter(order => order.side === 'buy');
    const sellOrders = pendingOrders.filter(order => order.side === 'sell');

    const buyRatio = pendingOrders.length > 0 ? (buyOrders.length / pendingOrders.length) * 100 : 0;

    // 古い注文の分析
    const now = Date.now();
    const oldOrders = pendingOrders.filter(order => {
      const ageHours = (now - order.createdAt) / (1000 * 60 * 60);
      return ageHours > 24;
    });

    // 健全性レベル決定
    let healthLevel = 'green';
    let healthMessage = '正常';

    if (pendingOrders.length > 100) {
      healthLevel = 'red';
      healthMessage = '未約定注文過多';
    } else if (pendingOrders.length > 50) {
      healthLevel = 'yellow';
      healthMessage = '未約定注文多め';
    } else if (oldOrders.length > 10) {
      healthLevel = 'yellow';
      healthMessage = '古い注文あり';
    } else if (buyRatio > 90) {
      healthLevel = 'yellow';
      healthMessage = '買い注文偏重';
    }

    return {
      healthLevel,
      healthMessage,
      totalOrders: pendingOrders.length,
      buyOrders: buyOrders.length,
      sellOrders: sellOrders.length,
      buyRatio: Math.round(buyRatio * 100) / 100,
      oldOrders: oldOrders.length,
      lastUpdated: Date.now()
    };

  } catch (error) {
    console.error('未約定注文健全性分析エラー:', error);
    return {
      healthLevel: 'red',
      healthMessage: 'データ取得エラー',
      error: error.message,
      lastUpdated: Date.now()
    };
  }
}

/**
 * 残高健全性の分析
 */
async function getBalanceHealth() {
  try {
    const balanceResults = await checkAllExchangeBalances();

    const totalExchanges = balanceResults.length;
    const healthyExchanges = balanceResults.filter(result => result.isHealthy).length;
    const discrepancies = balanceResults.reduce((total, result) =>
      total + (result.discrepancies ? result.discrepancies.length : 0), 0);

    // 健全性レベル決定
    let healthLevel = 'green';
    let healthMessage = '残高整合性OK';

    if (discrepancies > 6) {
      healthLevel = 'red';
      healthMessage = '重大な残高不整合';
    } else if (discrepancies > 1) {
      healthLevel = 'yellow';
      healthMessage = '軽微な残高不整合';
    } else if (healthyExchanges < totalExchanges) {
      healthLevel = 'yellow';
      healthMessage = '一部取引所でエラー';
    }

    return {
      healthLevel,
      healthMessage,
      totalExchanges,
      healthyExchanges,
      totalDiscrepancies: discrepancies,
      discrepancyRate: totalExchanges > 0 ? Math.round((discrepancies / totalExchanges) * 100) : 0,
      results: balanceResults,
      lastUpdated: Date.now()
    };

  } catch (error) {
    console.error('残高健全性分析エラー:', error);
    return {
      healthLevel: 'red',
      healthMessage: '残高チェックエラー',
      error: error.message,
      lastUpdated: Date.now()
    };
  }
}

/**
 * システムメトリクスの取得
 */
async function getSystemMetrics() {
  const uptime = process.uptime();
  const memUsage = process.memoryUsage();

  return {
    uptime: {
      seconds: Math.floor(uptime),
      formatted: formatUptime(uptime)
    },
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      total: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      usage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100) // %
    },
    node: {
      version: process.version,
      platform: process.platform
    },
    lastChecked: Date.now()
  };
}

/**
 * 全体健全性の計算
 */
function calculateOverallHealth(healthData) {
  const levels = healthData.map(data => data.healthLevel);

  if (levels.includes('red')) {
    return {
      level: 'red',
      message: '重大な問題が検出されました',
      severity: 'critical'
    };
  } else if (levels.includes('yellow')) {
    return {
      level: 'yellow',
      message: '注意が必要な項目があります',
      severity: 'warning'
    };
  } else {
    return {
      level: 'green',
      message: 'システムは正常に動作しています',
      severity: 'normal'
    };
  }
}

/**
 * アップタイムの人間読みやすい形式への変換
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}日 ${hours}時間 ${minutes}分`;
  } else if (hours > 0) {
    return `${hours}時間 ${minutes}分`;
  } else {
    return `${minutes}分`;
  }
}

module.exports = {
  getSystemHealth
};