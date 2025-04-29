const { postResultToDiscord, postErrorToDiscord } = require('./common/notifications');
const { exchangeBB, exchangeBF } = require('./config');
const { getTradeSummaries } = require('./database/manager');
const { initializeDB } = require('./database/manager');

// レポートを投稿するためのタイマー設定
setInterval(() => {
  const now = new Date();
  if (now.getMinutes() === 0) { // 時間ごと
    main();
  }
}, 60000);

async function main() {
  // 初期レポートを投稿
  await postReport(exchangeBB);
  await postReport(exchangeBF);
}

main();

async function postReport(exchange) {
  await initializeDB();

  // 全体資産計算レポート
  const totalAssetReport = await calculateTotalAssets(exchange).then(report => {
    let reportMessage = `# 全体資産計算レポート (${report.exchange})\n`;
    reportMessage += `**合計資産 (JPY):** ${report.totalAssetsJPY.toLocaleString()} JPY\n\n`;
    reportMessage += `**資産詳細:**\n`;

    if (report.assets && report.assets.length > 0) {
      report.assets.forEach(asset => {
        reportMessage += `- ${asset.currency}: ${asset.amount.toFixed(8)} (${asset.valueJPY.toLocaleString()} JPY)\n`;
      });
    } else {
      reportMessage += "資産情報はありません。\n";
    }

    return reportMessage;
  })
  await postResultToDiscord(totalAssetReport);

  const tradeSummaryReport = await getTradeSummaries(exchange.id).then(summaries => {
    let reportMessage = `# ${exchange.name || '不明な取引所'} トレードサマリー\n\n`;

    if (!summaries || summaries.length === 0) {
      reportMessage += "トレードサマリーはありません。\n";
    } else {
      // 戦略ごとにグループ化
      const summariesByStrategy = summaries.reduce((acc, summary) => {
        const strategy = summary.strategyKey || '不明な戦略';
        if (!acc[strategy]) {
          acc[strategy] = [];
        }
        acc[strategy].push(summary);
        return acc;
      }, {});

      for (const strategy in summariesByStrategy) {
        // 戦略ごとの合計を計算
        const strategyTotalPnL = summariesByStrategy[strategy].reduce((sum, s) => sum + s.realizedPnL, 0);
        const strategyTotalFee = summariesByStrategy[strategy].reduce((sum, s) => sum + s.totalFee, 0);
        const strategyNetResult = strategyTotalPnL - strategyTotalFee;

        reportMessage += `## ${strategy} (計: ${strategyTotalPnL.toLocaleString()} JPY, Fee: ${strategyTotalFee.toLocaleString()} JPY, = ${strategyNetResult.toLocaleString()} JPY)\n`;
        summariesByStrategy[strategy].forEach(summary => {
          reportMessage += `**${summary.symbol}**\n`;
          reportMessage += `- Position: ${summary.netPosition.toFixed(8)}\n`;
          reportMessage += `- PnL: ${summary.realizedPnL.toLocaleString()} JPY\n`;
          reportMessage += `- Fee: ${summary.totalFee.toLocaleString()} JPY\n`;
        });
        reportMessage += '\n';
      }
    }

    return reportMessage;

  });

  await postResultToDiscord(tradeSummaryReport);
}

async function calculateTotalAssets(exchange) {
  try {
    // 残高情報を取得
    const balanceResult = await exchange.fetchBalance();
    const balance = balanceResult.total;

    // 合計資産を計算
    let totalAssets = 0;
    let assetDetails = [];
    
    // 残高オブジェクトの各通貨について処理
    for (const currency in balance) {
      const amount = balance[currency];
      
      // 量が0より大きい場合のみ計算に含める
      if (amount > 0) {
        let value;
        
        // 基準通貨（JPY）の場合はそのまま加算
        if (currency === 'JPY') {
          value = amount;
        } else {
          // それ以外の通貨はJPYに換算して加算
          const symbol = `${currency}/JPY`;
          try {
            console.log('Fetching ticker for symbol:', symbol);
            const ticker = await exchange.fetchTicker(symbol);
            console.log('Ticker response:', ticker);
            const price = ticker.last; // または ticker.close など、適切な価格フィールドを選択
            value = amount * price;
          } catch (e) {
            console.error(`${symbol}の価格取得に失敗しました:`, e);
            continue;
          }
        }
        
        // 合計に加算
        totalAssets += value;
        
        // 詳細情報を追加
        assetDetails.push({
          currency,
          amount,
          valueJPY: Math.round(value),
        });
      }
    }
    
    // 結果を返す
    return {
      timestamp: new Date().toISOString(),
      exchange: exchange.name || '不明な取引所',
      totalAssetsJPY: Math.round(totalAssets),
      assets: assetDetails,
    };
  } catch (error) {
    console.error('資産計算中にエラーが発生しました:', error);
    await postErrorToDiscord(`資産計算中にエラーが発生しました: ${error.message}`);
    return {
      timestamp: new Date().toISOString(),
      exchange: exchange.name || '不明な取引所',
      error: error.message,
    };
  }
}
