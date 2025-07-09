/**
 * ダッシュボード画面の機能を制御するスクリプト
 */

// グローバル変数
let currentOrderPairs = []; // 注文ペアデータを保持
let currentSymbolFilter = 'all'; // 選択中の銘柄フィルタ
let filledPositionsDataTable = null; // 未売却ポジションDataTable
let riskPositionsDataTable = null; // リスク管理ポジションDataTable

/**
 * 初期化関数
 */
function initDashboard() {
  console.log('ダッシュボードの初期化を開始します');

  // サマリーデータの読み込みと表示
  loadAndDisplaySummary();

  // 日次損益データの読み込みと表示
  loadAndDisplayDailyPnL();

  // タブ切り替えイベントリスナー設定
  const summaryTabs = document.getElementById('summaryTabs');
  if (summaryTabs) {
    summaryTabs.addEventListener('shown.bs.tab', function (event) {
      // アクティブになったタブのIDを取得
      const activeTabId = event.target.id;
      console.log(`タブが切り替えられました: ${activeTabId}`);

      // リスク管理タブが表示された場合はデータを読み込み
      if (activeTabId === 'risk-management-tab') {
        loadAndDisplayRiskPositions();
        loadAndDisplayRiskStats();
      }

      // 未売却ポジションタブが表示された場合はデータを読み込み
      if (activeTabId === 'filled-positions-tab') {
        loadAndDisplayFilledPositions();
      }

      // 必要に応じて各タブのコンテンツを再レンダリング（データは既にロード済み）
      // loadAndDisplaySummary() で一度ロード・集計したデータを使用
      // ここでは特に再レンダリングは不要だが、複雑なUIの場合は必要になることも
    });
  }

  // 注文ペアサマリーの銘柄フィルターのイベントリスナー設定
  const symbolFilter = document.getElementById('order-pair-symbol-filter');
  if (symbolFilter) {
    symbolFilter.addEventListener('change', function() {
      currentSymbolFilter = this.value;
      // 注文ペアサマリーの再表示
      renderOrderPairsSummary(currentOrderPairs);
    });
  }
}

// スクリプトが読み込まれたら即時実行
// DOMContentLoadedが既に発火していても動作するように
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard);
} else {
  // DOMはすでに読み込み済み
  initDashboard();
}

/**
 * サマリーデータを読み込み表示する
 */
async function loadAndDisplaySummary() {
  const loadingElement = document.getElementById('summary-loading');
  const containerElement = document.getElementById('summary-container');

  try {
    // APIからサマリーデータを取得
    const response = await fetch('/api/trade-summary');
    if (!response.ok) {
      throw new Error(`サマリー情報の取得に失敗しました (${response.status})`);
    }

    const data = await response.json();
    console.log('取得したサマリーデータ:', data);

    // データの処理と集計
    const processedData = processSummaryData(data.positions || []);

    // 各セクションの表示
    renderExchangeSummary(processedData.byExchange);
    renderSymbolSummary(processedData.bySymbol); // 銘柄別サマリーのレンダリングを追加
    renderStrategySummary(processedData.byStrategy);
    renderOrderPairsSummary(processedData.orderPairs); // 注文ペアサマリーのレンダリングを再度追加
    renderOverallSummary(processedData.orderPairs); // 全体統合サマリーのレンダリングを追加

    // 購入可能額の表示
    if (data.availableAmounts) {
      renderAvailableAmounts(data.availableAmounts);
    }

    // ローディング表示を非表示にしてコンテンツを表示
    if (loadingElement) {
      loadingElement.classList.add('d-none');
    }
    if (containerElement) {
      containerElement.classList.remove('d-none');
    }

  } catch (error) {
    console.error('サマリーデータの取得と表示中にエラーが発生しました:', error);

    // エラーメッセージを表示
    if (loadingElement) {
      loadingElement.innerHTML = `
        <div class="alert alert-danger" role="alert">
          データの読み込みに失敗しました: ${error.message}
        </div>
      `;
    }
  }
}
/**
 * 過去24時間の日次損益データを読み込み表示する
 */
async function loadAndDisplayDailyPnL() {
  const loadingElement = document.getElementById('daily-pnl-loading');
  const containerElement = document.getElementById('daily-pnl-container');

  // 初期表示はローディングスピナー
  if (loadingElement) {
    loadingElement.classList.remove('d-none');
  }
  if (containerElement) {
    containerElement.classList.add('d-none');
  }

  try {
    // 過去24時間の約定履歴を取得
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const startDateTimestamp = twentyFourHoursAgo.getTime();

    const response = await fetch(`/api/trades?startDate=${startDateTimestamp}`);
    if (!response.ok) {
      throw new Error(`日次損益データの取得に失敗しました (${response.status})`);
    }

    const trades = await response.json();
    console.log('取得した過去24時間の約定履歴:', trades);

    // 銘柄ごとの集計データ初期化
    const symbolSummaries = {};

    // データの計算
    let totalSellAmount = 0;  // 売った合計金額
    let totalBuyAmount = 0;   // 買った合計金額
    let totalFee = 0;         // 合計手数料
    let buyCount = 0;         // 買い注文数
    let sellCount = 0;        // 売り注文数
    let realizedPnL = 0;      // 実現損益

    // 時間順にソート（古い順）して計算精度を上げる
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    sortedTrades.forEach(trade => {
      const price = parseFloat(trade.price);
      const amount = parseFloat(trade.amount);
      const fee = parseFloat(trade.fee) || 0;
      const symbol = trade.symbol || 'unknown';

      // 銘柄ごとの集計データの初期化
      if (!symbolSummaries[symbol]) {
        symbolSummaries[symbol] = {
          buyAmount: 0,         // 買った量
          sellAmount: 0,        // 売った量
          totalBuyCost: 0,      // 買った総コスト
          totalSellValue: 0,    // 売った総価値
          netPosition: 0,       // 現在のポジション
          totalFee: 0,          // 手数料
          realizedPnL: 0        // 実現損益
        };
      }

      // 該当銘柄の集計データ
      const summary = symbolSummaries[symbol];

      if (trade.side === 'sell') {
        // 売り注文の処理
        const sellValue = price * amount;
        totalSellAmount += sellValue;
        totalFee += fee;
        sellCount++;

        // 銘柄ごとの集計を更新
        summary.sellAmount += amount;
        summary.totalSellValue += sellValue;
        summary.netPosition -= amount;
        summary.totalFee += fee;

        // 実現損益を計算 (redisDatabase.jsのロジック)
        // 平均購入コストに基づいた損益計算
        if (summary.buyAmount > 0) {
          const avgBuyCost = summary.totalBuyCost / summary.buyAmount;
          const soldCost = amount * avgBuyCost;
          const profit = sellValue - soldCost;
          summary.realizedPnL += profit;
          realizedPnL += profit; // 全体の実現損益にも加算
        }
      } else if (trade.side === 'buy') {
        // 買い注文の処理
        const buyValue = price * amount;
        totalBuyAmount += buyValue;
        totalFee += fee;
        buyCount++;

        // 銘柄ごとの集計を更新
        summary.buyAmount += amount;
        summary.totalBuyCost += buyValue;
        summary.netPosition += amount;
        summary.totalFee += fee;
      }
    });

    // 結果の表示
    const dailyPnlContainer = document.getElementById('daily-pnl-container');
    if (dailyPnlContainer) {
      // マージンを徹底的に調整した改良版
      dailyPnlContainer.innerHTML = `
    <div class="row g-3 mb-2">
      <!-- 主要な損益情報 -->
      <div class="col-md-6 mb-3">
        <div class="card shadow-sm">
          <div class="card-header py-2 bg-primary bg-opacity-10">
            <h5 class="card-title mb-0">損益サマリー</h5>
          </div>
          <div class="card-body p-3">
            <div class="row align-items-center">
              <div class="col-8">
                <div class="d-flex flex-column">
                  <div class="mb-3">
                    <p class="text-muted mb-1 small">実現損益</p>
                    <h3 class="${realizedPnL >= 0 ? 'text-success' : 'text-danger'} mb-0">
                      ${formatNumber(realizedPnL)} 円
                    </h3>
                  </div>
                  <div>
                    <p class="text-muted mb-1 small">手数料</p>
                    <h5 class="text-secondary mb-0">${formatNumber(totalFee)} 円</h5>
                  </div>
                </div>
              </div>
              <div class="col-4 text-center">
                <div class="rounded-circle p-2 ${realizedPnL >= 0 ? 'bg-success' : 'bg-danger'} bg-opacity-10">
                  <i class="bi ${realizedPnL >= 0 ? 'bi-graph-up-arrow' : 'bi-graph-down-arrow'} 
                     ${realizedPnL >= 0 ? 'text-success' : 'text-danger'}" style="font-size: 2rem;"></i>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 取引額情報 -->
      <div class="col-md-6 mb-3">
        <div class="card shadow-sm">
          <div class="card-header py-2 bg-info bg-opacity-10">
            <h5 class="card-title mb-0">取引額</h5>
          </div>
          <div class="card-body p-3">
            <div class="row align-items-center mb-3">
              <div class="col-7">
                <p class="text-muted mb-1 small">売った額</p>
                <h4 class="mb-0">${formatNumber(totalSellAmount)} 円</h4>
              </div>
              <div class="col-5 text-end">
                <span class="badge bg-success rounded-pill px-2 py-1">
                  <i class="bi bi-arrow-up-circle me-1"></i> ${sellCount}回
                </span>
              </div>
            </div>
            <div class="row align-items-center">
              <div class="col-7">
                <p class="text-muted mb-1 small">買った額</p>
                <h4 class="mb-0">${formatNumber(totalBuyAmount)} 円</h4>
              </div>
              <div class="col-5 text-end">
                <span class="badge bg-primary rounded-pill px-2 py-1">
                  <i class="bi bi-arrow-down-circle me-1"></i> ${buyCount}回
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 取引回数比率 -->
      <div class="col-12">
        <div class="card shadow-sm">
          <div class="card-header py-2 bg-secondary bg-opacity-10">
            <h5 class="card-title mb-0">取引回数比率</h5>
          </div>
          <div class="card-body p-3">
            <div class="progress" style="height: 28px;">
              <div class="progress-bar bg-success" role="progressbar" 
                   style="width: ${(sellCount / (buyCount + sellCount) * 100).toFixed(1)}%;" 
                   aria-valuenow="${sellCount}" aria-valuemin="0" aria-valuemax="${buyCount + sellCount}">
                売り ${sellCount}回 (${(sellCount / (buyCount + sellCount) * 100).toFixed(1)}%)
              </div>
              <div class="progress-bar bg-primary" role="progressbar" 
                   style="width: ${(buyCount / (buyCount + sellCount) * 100).toFixed(1)}%;" 
                   aria-valuenow="${buyCount}" aria-valuemin="0" aria-valuemax="${buyCount + sellCount}">
                買い ${buyCount}回 (${(buyCount / (buyCount + sellCount) * 100).toFixed(1)}%)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
    } else {
      console.error('日次損益を表示するためのコンテナが見つかりません');
    }

    // ポジション詳細を表示（続く部分はそのまま）
    renderPositionDetails(symbolSummaries);

    // ローディング表示を非表示にしてコンテンツを表示
    if (loadingElement) {
      loadingElement.classList.add('d-none');
    }
    if (containerElement) {
      containerElement.classList.remove('d-none');
    }

  } catch (error) {
    console.error('日次損益データの取得と表示中にエラーが発生しました:', error);

    // エラーメッセージを表示
    if (loadingElement) {
      loadingElement.innerHTML = `
        <div class="alert alert-danger" role="alert">
          日次損益データの読み込みに失敗しました: ${error.message}
        </div>
      `;
    }
    // コンテナは非表示のまま
    if (containerElement) {
      containerElement.classList.add('d-none');
    }
  }
}

/**
 * ポジション詳細を表示する関数
 * @param {Object} symbolSummaries - 銘柄ごとの集計データ
 */
function renderPositionDetails(symbolSummaries) {
  const container = document.getElementById('position-details-container');

  if (!container) {
    // コンテナがなければ作成
    const dailyPnlContainer = document.getElementById('daily-pnl-container');
    if (dailyPnlContainer) {
      const detailsContainer = document.createElement('div');
      detailsContainer.id = 'position-details-container';
      detailsContainer.className = 'mt-4';

      const detailsTitle = document.createElement('h5');
      detailsTitle.innerText = '銘柄別ポジション詳細';
      detailsContainer.appendChild(detailsTitle);

      const tableContainer = document.createElement('div');
      tableContainer.className = 'table-responsive';
      tableContainer.innerHTML = `
        <table class="table table-sm">
          <thead>
            <tr>
              <th>銘柄</th>
              <th class="text-end">買った量</th>
              <th class="text-end">売った量</th>
              <th class="text-end">現在のポジション</th>
              <th class="text-end">平均購入価格</th>
              <th class="text-end">実現損益</th>
            </tr>
          </thead>
          <tbody id="symbol-positions-body"></tbody>
        </table>
      `;

      detailsContainer.appendChild(tableContainer);
      dailyPnlContainer.appendChild(detailsContainer);
    }
  }

  // 銘柄別ポジション詳細の表示
  const symbolPositionsBody = document.getElementById('symbol-positions-body');
  if (symbolPositionsBody) {
    let html = '';

    Object.entries(symbolSummaries)
      .filter(([_, data]) => data.netPosition !== 0 || data.realizedPnL !== 0)
      .sort(([_, a], [__, b]) => b.realizedPnL - a.realizedPnL)
      .forEach(([symbol, data]) => {
        const avgBuyPrice = data.buyAmount > 0 ? data.totalBuyCost / data.buyAmount : 0;
        const pnlClass = data.realizedPnL >= 0 ? 'text-success' : 'text-danger';

        html += `
          <tr>
            <td>${symbol}</td>
            <td class="text-end">${formatNumber(data.buyAmount, 6)}</td>
            <td class="text-end">${formatNumber(data.sellAmount, 6)}</td>
            <td class="text-end">${formatNumber(data.netPosition, 6)}</td>
            <td class="text-end">${formatNumber(avgBuyPrice)}</td>
            <td class="text-end ${pnlClass}">${formatNumber(data.realizedPnL)}</td>
          </tr>
        `;
      });

    symbolPositionsBody.innerHTML = html || '<tr><td colspan="6" class="text-center">表示するポジションがありません</td></tr>';
  }
}

/**
 * APIから取得したデータを加工・集計する
 * @param {Array} data - APIから取得した注文ペアデータの配列
 * @returns {Object} - 加工後のデータ（byExchange, bySymbol, byStrategy, orderPairs）
 */
function processSummaryData(data) {
  // 結果を格納するオブジェクト
  const result = {
    byExchange: {},
    bySymbol: {}, // 銘柄別集計用
    byStrategy: {},
    orderPairs: [] // 注文ペアデータを保持
  };

  // 配列データの検証（共通関数を使用）
  const validation = CommonUtils.validateArrayData(data, 'APIレスポンス');
  if (!validation.isValid) {
    console.error(validation.error + ':', data);
    return result;
  }

  // 注文ペアデータとして元データを保存
  result.orderPairs = data;
  currentOrderPairs = data; // グローバル変数に保存

  // 各エントリを処理して集計（共通関数を使用）
  data.forEach(entry => {
    const { exchangeId, symbol, strategyKey, totalBuyCost, totalSellValue, totalFee, realizedPnL } = entry;

    // 取引所データの集計（共通関数を使用して安全な加算）
    CommonUtils.ensureNestedObject(result, `byExchange.${exchangeId}`, {
      totalBuyCost: 0,
      totalSellValue: 0,
      totalFee: 0,
      realizedPnL: 0,
      netPnL: 0,
      bySymbol: {},
      byStrategy: {}
    });

    const exchangeData = result.byExchange[exchangeId];
    exchangeData.totalBuyCost = CommonUtils.safeAdd(exchangeData.totalBuyCost, totalBuyCost);
    exchangeData.totalSellValue = CommonUtils.safeAdd(exchangeData.totalSellValue, totalSellValue);
    exchangeData.totalFee = CommonUtils.safeAdd(exchangeData.totalFee, totalFee);
    exchangeData.realizedPnL = CommonUtils.safeAdd(exchangeData.realizedPnL, realizedPnL);

    // 取引所内の銘柄別内訳の集計
    if (!result.byExchange[exchangeId].bySymbol[symbol]) {
      result.byExchange[exchangeId].bySymbol[symbol] = {
        totalBuyCost: 0,
        totalSellValue: 0,
        totalFee: 0,
        realizedPnL: 0,
        netPnL: 0
      };
    }
    result.byExchange[exchangeId].bySymbol[symbol].totalBuyCost += totalBuyCost || 0;
    result.byExchange[exchangeId].bySymbol[symbol].totalSellValue += totalSellValue || 0;
    result.byExchange[exchangeId].bySymbol[symbol].totalFee += totalFee || 0;
    result.byExchange[exchangeId].bySymbol[symbol].realizedPnL += realizedPnL || 0;

    // 取引所内の戦略別内訳の集計
    const strategyIdForExchange = strategyKey || 'unknown';
    if (!result.byExchange[exchangeId].byStrategy[strategyIdForExchange]) {
      result.byExchange[exchangeId].byStrategy[strategyIdForExchange] = {
        totalBuyCost: 0,
        totalSellValue: 0,
        totalFee: 0,
        realizedPnL: 0,
        netPnL: 0
      };
    }
    result.byExchange[exchangeId].byStrategy[strategyIdForExchange].totalBuyCost += totalBuyCost || 0;
    result.byExchange[exchangeId].byStrategy[strategyIdForExchange].totalSellValue += totalSellValue || 0;
    result.byExchange[exchangeId].byStrategy[strategyIdForExchange].totalFee += totalFee || 0;
    result.byExchange[exchangeId].byStrategy[strategyIdForExchange].realizedPnL += realizedPnL || 0;

    // 銘柄データの集計と内訳の保持
    if (!result.bySymbol[symbol]) {
      result.bySymbol[symbol] = {
        totalBuyCost: 0,
        totalSellValue: 0,
        totalFee: 0,
        realizedPnL: 0,
        netPnL: 0,
        totalNetPosition: 0, // netPositionを集計
        byExchange: {}, // 取引所別の内訳
        byStrategy: {} // 戦略別の内訳
      };
    }
    result.bySymbol[symbol].totalBuyCost += totalBuyCost || 0;
    result.bySymbol[symbol].totalSellValue += totalSellValue || 0;
    result.bySymbol[symbol].totalFee += totalFee || 0;
    result.bySymbol[symbol].realizedPnL += realizedPnL || 0;
    result.bySymbol[symbol].totalNetPosition += entry.netPosition || 0;

    // 銘柄内の取引所別内訳の集計
    if (!result.bySymbol[symbol].byExchange[exchangeId]) {
      result.bySymbol[symbol].byExchange[exchangeId] = {
        totalBuyCost: 0,
        totalSellValue: 0,
        totalFee: 0,
        realizedPnL: 0,
        netPnL: 0
      };
    }
    result.bySymbol[symbol].byExchange[exchangeId].totalBuyCost += totalBuyCost || 0;
    result.bySymbol[symbol].byExchange[exchangeId].totalSellValue += totalSellValue || 0;
    result.bySymbol[symbol].byExchange[exchangeId].totalFee += totalFee || 0;
    result.bySymbol[symbol].byExchange[exchangeId].realizedPnL += realizedPnL || 0;

    // 銘柄内の戦略別内訳の集計
    const strategyIdForSymbol = strategyKey || 'unknown';
    if (!result.bySymbol[symbol].byStrategy[strategyIdForSymbol]) {
      result.bySymbol[symbol].byStrategy[strategyIdForSymbol] = {
        totalBuyCost: 0,
        totalSellValue: 0,
        totalFee: 0,
        realizedPnL: 0,
        netPnL: 0
      };
    }
    result.bySymbol[symbol].byStrategy[strategyIdForSymbol].totalBuyCost += totalBuyCost || 0;
    result.bySymbol[symbol].byStrategy[strategyIdForSymbol].totalSellValue += totalSellValue || 0;
    result.bySymbol[symbol].byStrategy[strategyIdForSymbol].totalFee += totalFee || 0;
    result.bySymbol[symbol].byStrategy[strategyIdForSymbol].realizedPnL += realizedPnL || 0;

    // 戦略データの集計と内訳の保持
    const strategyId = strategyKey || 'unknown'; // strategyKeyがない場合はunknownとして集計
    if (!result.byStrategy[strategyId]) {
      result.byStrategy[strategyId] = {
        totalBuyCost: 0,
        totalSellValue: 0,
        totalFee: 0,
        realizedPnL: 0,
        netPnL: 0,
        byExchange: {}, // 取引所別の内訳
        bySymbol: {} // 銘柄別の内訳
      };
    }
    result.byStrategy[strategyId].totalBuyCost += totalBuyCost || 0;
    result.byStrategy[strategyId].totalSellValue += totalSellValue || 0;
    result.byStrategy[strategyId].totalFee += totalFee || 0;
    result.byStrategy[strategyId].realizedPnL += realizedPnL || 0;

    // 戦略内の取引所別内訳の集計
    if (!result.byStrategy[strategyId].byExchange[exchangeId]) {
      result.byStrategy[strategyId].byExchange[exchangeId] = {
        totalBuyCost: 0,
        totalSellValue: 0,
        totalFee: 0,
        realizedPnL: 0,
        netPnL: 0
      };
    }
    result.byStrategy[strategyId].byExchange[exchangeId].totalBuyCost += totalBuyCost || 0;
    result.byStrategy[strategyId].byExchange[exchangeId].totalSellValue += totalSellValue || 0;
    result.byStrategy[strategyId].byExchange[exchangeId].totalFee += totalFee || 0;
    result.byStrategy[strategyId].byExchange[exchangeId].realizedPnL += realizedPnL || 0;

    // 戦略内の銘柄別内訳の集計
    if (!result.byStrategy[strategyId].bySymbol[symbol]) {
      result.byStrategy[strategyId].bySymbol[symbol] = {
        totalBuyCost: 0,
        totalSellValue: 0,
        totalFee: 0,
        realizedPnL: 0,
        netPnL: 0
      };
    }
    result.byStrategy[strategyId].bySymbol[symbol].totalBuyCost += totalBuyCost || 0;
    result.byStrategy[strategyId].bySymbol[symbol].totalSellValue += totalSellValue || 0;
    result.byStrategy[strategyId].bySymbol[symbol].totalFee += totalFee || 0;
    result.byStrategy[strategyId].bySymbol[symbol].realizedPnL += realizedPnL || 0;
  });

  // 純損益の計算
  Object.keys(result.byExchange).forEach(key => {
    result.byExchange[key].netPnL = result.byExchange[key].realizedPnL - result.byExchange[key].totalFee;
    // 内訳の純損益も計算
    Object.keys(result.byExchange[key].bySymbol).forEach(subKey => {
      result.byExchange[key].bySymbol[subKey].netPnL = result.byExchange[key].bySymbol[subKey].realizedPnL - result.byExchange[key].bySymbol[subKey].totalFee;
    });
    Object.keys(result.byExchange[key].byStrategy).forEach(subKey => {
      result.byExchange[key].byStrategy[subKey].netPnL = result.byExchange[key].byStrategy[subKey].realizedPnL - result.byExchange[key].byStrategy[subKey].totalFee;
    });
  });

  Object.keys(result.bySymbol).forEach(key => {
    result.bySymbol[key].netPnL = result.bySymbol[key].realizedPnL - result.bySymbol[key].totalFee;
    // 内訳の純損益も計算
    Object.keys(result.bySymbol[key].byExchange).forEach(subKey => {
      result.bySymbol[key].byExchange[subKey].netPnL = result.bySymbol[key].byExchange[subKey].realizedPnL - result.bySymbol[key].byExchange[subKey].totalFee;
    });
    Object.keys(result.bySymbol[key].byStrategy).forEach(subKey => {
      result.bySymbol[key].byStrategy[subKey].netPnL = result.bySymbol[key].byStrategy[subKey].realizedPnL - result.bySymbol[key].byStrategy[subKey].totalFee;
    });
  });

  Object.keys(result.byStrategy).forEach(key => {
    result.byStrategy[key].netPnL = result.byStrategy[key].realizedPnL - result.byStrategy[key].totalFee;
    // 内訳の純損益も計算
    Object.keys(result.byStrategy[key].byExchange).forEach(subKey => {
      result.byStrategy[key].byExchange[subKey].netPnL = result.byStrategy[key].byExchange[subKey].realizedPnL - result.byStrategy[key].byExchange[subKey].totalFee;
    });
    Object.keys(result.byStrategy[key].bySymbol).forEach(subKey => {
      result.byStrategy[key].bySymbol[subKey].netPnL = result.byStrategy[key].bySymbol[subKey].realizedPnL - result.byStrategy[key].bySymbol[subKey].totalFee;
    });
  });

  return result;
}

/**
 * 内訳データをグラフと表形式でレンダリングし、グラフを描画するヘルパー関数
 * @param {Object} breakdownData - 内訳データ（例: 銘柄別の集計オブジェクト）
 * @param {string} title - 内訳のタイトル（例: '銘柄別内訳'）
 * @param {string} parentId - グラフと表を描画する親要素のID
 */
function renderBreakdownGraphAndTable(breakdownData, title, parentId) {
  const parentContainer = document.getElementById(parentId);
  if (!parentContainer || !breakdownData || Object.keys(breakdownData).length === 0) {
    return; // データがない場合や親要素がない場合は何もしない
  }

  // 既存の内訳表示をクリア
  parentContainer.innerHTML = '';

  let html = `
        <div class="breakdown-section mt-3">
            <h6>${title}</h6>
            <div class="breakdown-chart-container">
                <canvas id="${parentId}-${title.replace(/\s+/g, '-')}-chart"></canvas>
            </div>
            <div class="breakdown-table-container mt-3">
                <table class="table table-sm table-borderless small">
                    <thead>
                        <tr>
                            <th>項目</th>
                            <th class="text-end">手数料</th>
                            <th class="text-end">実現損益</th>
                            <th class="text-end">純損益</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

  Object.keys(breakdownData).forEach(key => {
    const data = breakdownData[key];
    const netPnlClass = data.netPnL > 0 ? 'text-success' : data.netPnL < 0 ? 'text-danger' : '';
    const realizedPnlClass = data.realizedPnL > 0 ? 'text-success' : data.realizedPnL < 0 ? 'text-danger' : '';

    html += `
            <tr>
                <td>${key}</td>
                <td class="text-end">${formatNumber(data.totalFee)} 円</td>
                <td class="text-end ${realizedPnlClass}">${formatNumber(data.realizedPnL)} 円</td>
                <td class="text-end ${netPnlClass} fw-bold">${formatNumber(data.netPnL)} 円</td>
            </tr>
        `;
  });

  html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

  // 新しいHTMLを挿入
  parentContainer.innerHTML = html;

  // グラフデータの準備
  const labels = Object.keys(breakdownData);
  const netPnLData = Object.values(breakdownData).map(item => item.netPnL);

  // グラフの描画
  const ctx = document.getElementById(`${parentId}-${title.replace(/\s+/g, '-')}-chart`).getContext('2d');
  new Chart(ctx, {
    type: 'bar', // 棒グラフ
    data: {
      labels: labels,
      datasets: [{
        label: '純損益 (円)',
        data: netPnLData,
        backgroundColor: netPnLData.map(pnl => pnl > 0 ? 'rgba(25, 135, 84, 0.6)' : 'rgba(220, 53, 69, 0.6)'), // プラスは緑、マイナスは赤
        borderColor: netPnLData.map(pnl => pnl > 0 ? 'rgba(25, 135, 84, 1)' : 'rgba(220, 53, 69, 1)'),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: '金額 (円)'
          }
        }
      },
      plugins: {
        legend: {
          display: false // 凡例は非表示
        },
        title: {
          display: true,
          text: title + ' 純損益' // グラフタイトル
        }
      }
    }
  });
}

/**
 * 汎用データサマリーレンダリング関数
 * Dashboard rendering pattern template function
 * @param {Object} inputData - レンダリングするデータ
 * @param {string} containerId - コンテナ要素のID
 * @param {string} keyName - データのキー名 (exchangeId, symbol, strategyKey)
 * @param {string} breakdownPrefix - 内訳コンテナのプレフィックス
 * @param {Function} breakdownCallback - 内訳表示のコールバック関数
 */
function renderDataSummary(inputData, containerId, keyName, breakdownPrefix, breakdownCallback) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  // データがない場合
  if (!inputData || Object.keys(inputData).length === 0) {
    container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
    return;
  }

  // データを実現損益順にソート
  const sortedData = Object.entries(inputData)
    .map(([key, data]) => ({ [keyName]: key, ...data }))
    .sort((a, b) => b.netPnL - a.netPnL);

  let html = '';

  // 各データのカードを生成
  sortedData.forEach(data => {
    const netPnlClass = data.netPnL > 0 ? 'text-success' : data.netPnL < 0 ? 'text-danger' : '';
    const displayKey = data[keyName];

    html += `
    <div class="col-md-6 col-lg-4 mb-3">
      <div class="card h-100 summary-card-clickable">
        <div class="card-header">
          <h6 class="mb-0">${displayKey}</h6>
        </div>
        <div class="card-body">
          <table class="table table-sm mb-0">
            <tbody>
              <tr>
                <td>買った額</td>
                <td class="text-end">${formatNumber(data.totalBuyCost)} 円</td>
              </tr>
              <tr>
                <td>売った額</td>
                <td class="text-end">${formatNumber(data.totalSellValue)} 円</td>
              </tr>`;

    // 銘柄の場合のみ保有量を表示
    if (keyName === 'symbol') {
      html += `
              <tr>
                <td>現在保有量</td>
                <td class="text-end ${data.totalNetPosition > 0 ? 'text-success' : data.totalNetPosition < 0 ? 'text-danger' : ''}">
                  ${formatAmount(data.totalNetPosition, 8)} ${extractBaseAsset(displayKey)}
                </td>
              </tr>`;
    }

    html += `
              <tr>
                <td>手数料</td>
                <td class="text-end">${formatNumber(data.totalFee)} 円</td>
              </tr>
              <tr>
                <td>実現損益</td>
                <td class="text-end ${data.realizedPnL > 0 ? 'text-success' : data.realizedPnL < 0 ? 'text-danger' : ''}">
                  ${formatNumber(data.realizedPnL)} 円
                </td>
              </tr>
              <tr>
                <td>純損益</td>
                <td class="text-end ${netPnlClass} fw-bold">
                  ${formatNumber(data.netPnL)} 円
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 内訳コンテナ (最初は非表示) -->
          <div class="breakdown-container" id="${breakdownPrefix}-${displayKey}-breakdown" style="display: none;">
              <!-- 内訳グラフがここに描画されます -->
          </div>

        </div>
      </div>
    </div>
    `;
  });

  container.innerHTML = html;

  // クリックイベントリスナーを設定し、グラフを描画
  container.querySelectorAll('.summary-card-clickable').forEach(card => {
    card.addEventListener('click', function() {
      const breakdownContainer = this.querySelector('.breakdown-container');
      const displayKey = this.querySelector('.card-header h6').innerText;
      const data = inputData[displayKey];

      if (breakdownContainer) {
        // 表示/非表示をトグル
        if (breakdownContainer.style.display === 'none') {
          breakdownContainer.style.display = 'block';
          // コールバック関数でカスタムな内訳表示を実行
          if (breakdownCallback) {
            breakdownCallback(data, breakdownContainer.id);
          }
        } else {
          breakdownContainer.style.display = 'none';
          // コンテンツをクリア
          breakdownContainer.innerHTML = '';
        }
      }
    });
  });
}

/**
 * 取引所別サマリーを表示する
 * @param {Object} exchangeData - 取引所別にグループ化されたデータ（内訳含む）
 */
function renderExchangeSummary(exchangeData) {
  // 取引所別内訳表示のコールバック関数
  const exchangeBreakdownCallback = (data, containerId) => {
    renderBreakdownGraphAndTable(data.bySymbol, '銘柄別内訳', containerId);
    renderBreakdownGraphAndTable(data.byStrategy, '戦略別内訳', containerId);
  };

  // 汎用テンプレート関数を使用
  renderDataSummary(exchangeData, 'exchange-summary-container', 'exchangeId', 'exchange', exchangeBreakdownCallback);
}

/**
 * 銘柄別サマリーを表示する
 * @param {Object} symbolData - 銘柄別にグループ化されたデータ（内訳含む）
 */
function renderSymbolSummary(symbolData) {
  // 銘柄別内訳表示のコールバック関数
  const symbolBreakdownCallback = (data, containerId) => {
    renderBreakdownGraphAndTable(data.byExchange, '取引所別内訳', containerId);
    renderBreakdownGraphAndTable(data.byStrategy, '戦略別内訳', containerId);
  };

  // 汎用テンプレート関数を使用
  renderDataSummary(symbolData, 'symbol-summary-container', 'symbol', 'symbol', symbolBreakdownCallback);
}

/**
 * 戦略別サマリーを表示する
 * @param {Object} strategyData - 戦略別にグループ化されたデータ（内訳含む）
 */
function renderStrategySummary(strategyData) {
  // 戦略別内訳表示のコールバック関数
  const strategyBreakdownCallback = (data, containerId) => {
    renderBreakdownGraphAndTable(data.byExchange, '取引所別内訳', containerId);
    renderBreakdownGraphAndTable(data.bySymbol, '銘柄別内訳', containerId);
  };

  // 汎用テンプレート関数を使用
  renderDataSummary(strategyData, 'strategy-summary-container', 'strategyKey', 'strategy', strategyBreakdownCallback);
}

/**
 * 注文ペアサマリーを表示する
 * @param {Array} orderPairs - 注文ペアデータの配列
 */
function renderOrderPairsSummary(orderPairs) {
  const container = document.getElementById('order-pairs-summary-container');
  if (!container) {
    return;
  }

  // 銘柄ドロップダウンの更新
  updateOrderPairSymbolDropdown(orderPairs);

  // データがない場合
  if (!orderPairs || orderPairs.length === 0) {
    container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
    return;
  }

  // フィルタリング
  let filteredPairs = orderPairs;
  if (currentSymbolFilter !== 'all') {
    filteredPairs = orderPairs.filter(item => item.symbol === currentSymbolFilter);
  }

  // フィルタ後にデータがない場合
  if (filteredPairs.length === 0) {
    container.innerHTML = '<div class="col-12"><div class="alert alert-info">条件に一致する注文ペアはありません</div></div>';
    return;
  }

  let html = '';

  // 各注文ペアのカードを生成
  filteredPairs.forEach(item => {
    const buyOrder = item.pair?.buyOrder || {};
    const sellOrder = item.pair?.sellOrder || {};

    // 日時フォーマット
    const formatDate = timestamp => {
      if (!timestamp) {
        return '-';
      }
      const date = new Date(timestamp);
      return date.toLocaleString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    // ステータスに対応するバッジクラス
    const getStatusBadgeClass = status => {
      switch (status) {
      case 'open': return 'bg-primary';
      case 'closed': return 'bg-success';
      case 'canceled': return 'bg-warning';
      case 'expired': return 'bg-secondary';
      case 'rejected': return 'bg-danger';
      default: return 'bg-secondary';
      }
    };

    // 価格データのフォーマット
    const buyPrice = buyOrder.price ? buyOrder.price.toLocaleString() : '-';
    const sellPrice = sellOrder.price ? sellOrder.price.toLocaleString() : '-';
    const buyStatus = buyOrder.status || '-';
    const sellStatus = sellOrder.status || '-';
    const amount = item.pair?.amount || buyOrder.amount || sellOrder.amount || 0;

    // サマリー情報のフォーマット
    const buyAmount = item.buyAmount || 0;
    const sellAmount = item.sellAmount || 0;
    const netPosition = item.netPosition || 0;
    const totalBuyCost = item.totalBuyCost || 0;
    const totalSellValue = item.totalSellValue || 0;
    const realizedPnL = item.realizedPnL || 0;
    const totalFee = item.totalFee || 0;

    // ポジション状態の色分け
    const positionClass = netPosition > 0 ? 'text-success' : netPosition < 0 ? 'text-danger' : 'text-muted';
    const pnlClass = realizedPnL > 0 ? 'text-success' : realizedPnL < 0 ? 'text-danger' : 'text-muted';

    html += `
    <div class="col-md-6 col-lg-4 mb-3">
      <div class="card h-100 order-pair-card">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h6 class="mb-0">${item.symbol}</h6>
          <small class="text-muted">${item.exchangeId}</small>
        </div>
        <div class="card-body">
          <p class="small text-muted mb-2">${item.strategyKey}</p>

          <div class="mb-2">
            <div class="d-flex justify-content-between">
              <span class="price-label">買価格:</span>
              <span class="buy-price">${buyPrice}</span>
            </div>
            <div class="d-flex justify-content-between">
              <span class="price-label">売価格:</span>
              <span class="sell-price">${sellPrice}</span>
            </div>
          </div>

          <div class="small mb-2">数量: ${amount}</div>

          <div class="d-flex justify-content-between mb-2">
            <span>買: <span class="badge ${getStatusBadgeClass(buyStatus)}">${buyStatus}</span></span>
            <span>売: <span class="badge ${getStatusBadgeClass(sellStatus)}">${sellStatus}</span></span>
          </div>

          <!-- サマリー情報セクション -->
          <div class="border-top pt-2 mb-2">
            <h6 class="small text-muted mb-1">ポジション情報</h6>
            <div class="d-flex justify-content-between small">
              <span>買った量:</span>
              <span>${formatNumber(buyAmount, 4)}</span>
            </div>
            <div class="d-flex justify-content-between small">
              <span>売った量:</span>
              <span>${formatNumber(sellAmount, 4)}</span>
            </div>
            <div class="d-flex justify-content-between small">
              <span>現在ポジション:</span>
              <span class="${positionClass}">${formatNumber(netPosition, 4)}</span>
            </div>
          </div>

          <div class="border-top pt-2 mb-2">
            <h6 class="small text-muted mb-1">損益情報</h6>
            <div class="d-flex justify-content-between small">
              <span>実現損益:</span>
              <span class="${pnlClass}">${formatNumber(realizedPnL, 2)}</span>
            </div>
            <div class="d-flex justify-content-between small">
              <span>手数料合計:</span>
              <span>${formatNumber(totalFee, 2)}</span>
            </div>
          </div>

          <div class="border-top pt-2 small text-muted">
            <div>買: ${formatDate(buyOrder.timestamp)}</div>
            <div>売: ${formatDate(sellOrder.timestamp)}</div>
          </div>
        </div>
      </div>
    </div>
    `;
  });

  container.innerHTML = html;
}

/**
 * 全体統合サマリーを表示する
 * @param {Array} orderPairs - 注文ペアデータの配列
 */
function renderOverallSummary(orderPairs) {
  const container = document.getElementById('overall-summary-container');
  if (!container) {
    return;
  }

  // データがない場合
  if (!orderPairs || orderPairs.length === 0) {
    container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
    return;
  }

  // 全体のサマリーを計算
  let totalBuyAmount = 0;
  let totalSellAmount = 0;
  let totalNetPosition = 0;
  let totalBuyCost = 0;
  let totalSellValue = 0;
  let totalRealizedPnL = 0;
  let totalFee = 0;

  // 取引所別・銘柄別の集計
  const byExchange = {};
  const bySymbol = {};

  orderPairs.forEach(item => {
    totalBuyAmount += item.buyAmount || 0;
    totalSellAmount += item.sellAmount || 0;
    totalNetPosition += item.netPosition || 0;
    totalBuyCost += item.totalBuyCost || 0;
    totalSellValue += item.totalSellValue || 0;
    totalRealizedPnL += item.realizedPnL || 0;
    totalFee += item.totalFee || 0;

    // 取引所別集計
    if (!byExchange[item.exchangeId]) {
      byExchange[item.exchangeId] = {
        buyAmount: 0,
        sellAmount: 0,
        netPosition: 0,
        realizedPnL: 0,
        totalFee: 0
      };
    }
    byExchange[item.exchangeId].buyAmount += item.buyAmount || 0;
    byExchange[item.exchangeId].sellAmount += item.sellAmount || 0;
    byExchange[item.exchangeId].netPosition += item.netPosition || 0;
    byExchange[item.exchangeId].realizedPnL += item.realizedPnL || 0;
    byExchange[item.exchangeId].totalFee += item.totalFee || 0;

    // 銘柄別集計
    if (!bySymbol[item.symbol]) {
      bySymbol[item.symbol] = {
        buyAmount: 0,
        sellAmount: 0,
        netPosition: 0,
        realizedPnL: 0,
        totalFee: 0
      };
    }
    bySymbol[item.symbol].buyAmount += item.buyAmount || 0;
    bySymbol[item.symbol].sellAmount += item.sellAmount || 0;
    bySymbol[item.symbol].netPosition += item.netPosition || 0;
    bySymbol[item.symbol].realizedPnL += item.realizedPnL || 0;
    bySymbol[item.symbol].totalFee += item.totalFee || 0;
  });

  // 損益率を計算
  const pnlPercentage = totalBuyCost > 0 ? (totalRealizedPnL / totalBuyCost * 100) : 0;
  const pnlClass = totalRealizedPnL > 0 ? 'text-success' : totalRealizedPnL < 0 ? 'text-danger' : 'text-muted';

  let html = `
    <!-- 全体サマリーカード -->
    <div class="col-12 mb-3">
      <div class="card">
        <div class="card-header bg-primary text-white">
          <h6 class="mb-0">全戦略統合サマリー</h6>
        </div>
        <div class="card-body">
          <div class="row">
            <div class="col-md-4">
              <h6 class="text-muted small">ポジション情報</h6>
              <div class="d-flex justify-content-between">
                <span>総買付額:</span>
                <span>${formatNumber(totalBuyCost, 2)}</span>
              </div>
              <div class="d-flex justify-content-between">
                <span>総売却額:</span>
                <span>${formatNumber(totalSellValue, 2)}</span>
              </div>
              <div class="d-flex justify-content-between">
                <span>ポジション取得価額:</span>
                <span>${formatNumber(totalNetPosition * (totalBuyCost / totalBuyAmount || 0), 2)}</span>
              </div>
              <div class="small text-muted mt-1">
                ※市場価格での評価は取引所APIから別途取得してください
              </div>
            </div>
            <div class="col-md-4">
              <h6 class="text-muted small">数量情報</h6>
              <div class="d-flex justify-content-between">
                <span>買った量:</span>
                <span>${formatNumber(totalBuyAmount, 4)}</span>
              </div>
              <div class="d-flex justify-content-between">
                <span>売った量:</span>
                <span>${formatNumber(totalSellAmount, 4)}</span>
              </div>
              <div class="d-flex justify-content-between">
                <span>現在ポジション:</span>
                <span class="${totalNetPosition > 0 ? 'text-success' : totalNetPosition < 0 ? 'text-danger' : 'text-muted'}">${formatNumber(totalNetPosition, 4)}</span>
              </div>
            </div>
            <div class="col-md-4">
              <h6 class="text-muted small">損益情報</h6>
              <div class="d-flex justify-content-between">
                <span>実現損益:</span>
                <span class="${pnlClass}">${formatNumber(totalRealizedPnL, 2)}</span>
              </div>
              <div class="d-flex justify-content-between">
                <span>損益率:</span>
                <span class="${pnlClass}">${formatNumber(pnlPercentage, 2)}%</span>
              </div>
              <div class="d-flex justify-content-between">
                <span>手数料合計:</span>
                <span>${formatNumber(totalFee, 2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 取引所別サマリー -->
    <div class="col-md-6 mb-3">
      <div class="card h-100">
        <div class="card-header">
          <h6 class="mb-0">取引所別サマリー</h6>
        </div>
        <div class="card-body">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>取引所</th>
                <th>ポジション</th>
                <th>実現損益</th>
              </tr>
            </thead>
            <tbody>
  `;

  Object.entries(byExchange).forEach(([exchangeId, data]) => {
    const exchangePnlClass = data.realizedPnL > 0 ? 'text-success' : data.realizedPnL < 0 ? 'text-danger' : 'text-muted';
    const positionClass = data.netPosition > 0 ? 'text-success' : data.netPosition < 0 ? 'text-danger' : 'text-muted';
    html += `
              <tr>
                <td>${exchangeId}</td>
                <td class="${positionClass}">${formatNumber(data.netPosition, 4)}</td>
                <td class="${exchangePnlClass}">${formatNumber(data.realizedPnL, 2)}</td>
              </tr>
    `;
  });

  html += `
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 銘柄別サマリー（上位5件） -->
    <div class="col-md-6 mb-3">
      <div class="card h-100">
        <div class="card-header">
          <h6 class="mb-0">銘柄別サマリー（上位5件）</h6>
        </div>
        <div class="card-body">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>銘柄</th>
                <th>ポジション</th>
                <th>実現損益</th>
              </tr>
            </thead>
            <tbody>
  `;

  // 実現損益の絶対値でソートして上位5件を取得
  const topSymbols = Object.entries(bySymbol)
    .sort((a, b) => Math.abs(b[1].realizedPnL) - Math.abs(a[1].realizedPnL))
    .slice(0, 5);

  topSymbols.forEach(([symbol, data]) => {
    const symbolPnlClass = data.realizedPnL > 0 ? 'text-success' : data.realizedPnL < 0 ? 'text-danger' : 'text-muted';
    const positionClass = data.netPosition > 0 ? 'text-success' : data.netPosition < 0 ? 'text-danger' : 'text-muted';
    html += `
              <tr>
                <td>${symbol}</td>
                <td class="${positionClass}">${formatNumber(data.netPosition, 4)}</td>
                <td class="${symbolPnlClass}">${formatNumber(data.realizedPnL, 2)}</td>
              </tr>
    `;
  });

  html += `
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * 注文ペア用の銘柄ドロップダウンを更新
 * @param {Array} orderPairs - 注文ペアデータの配列
 */
function updateOrderPairSymbolDropdown(orderPairs) {
  const dropdown = document.getElementById('order-pair-symbol-filter');
  if (!dropdown || !orderPairs || orderPairs.length === 0) {
    return;
  }

  // 現在の選択値を保存
  const currentValue = dropdown.value;

  // ユニークな銘柄リストを取得
  const uniqueSymbols = [...new Set(orderPairs.map(item => item.symbol))].sort();

  // ドロップダウンの選択肢を更新
  let options = '<option value="all">すべて表示</option>';
  uniqueSymbols.forEach(symbol => {
    options += `<option value="${symbol}">${symbol}</option>`;
  });

  dropdown.innerHTML = options;

  // 前回の選択値を復元（存在すれば）
  if (currentSymbolFilter === 'all' || uniqueSymbols.includes(currentSymbolFilter)) {
    dropdown.value = currentSymbolFilter;
  } else {
    currentSymbolFilter = 'all';
    dropdown.value = 'all';
  }
}

/**
 * 数値を読みやすい形式にフォーマットする
 * @param {number} num - フォーマットする数値
 * @param {number} maxDigits - 小数点以下の最大桁数（デフォルト4）
 * @returns {string} - フォーマットされた数値文字列
 */
function formatNumber(num, maxDigits = 4) {
  if (num === null || num === undefined) {
    return '0';
  }

  // 大きな数値の場合は小数点以下を省略
  if (Math.abs(num) >= 1000) {
    return Math.round(num).toLocaleString();
  }

  // 小さな数値の場合は指定された小数点以下桁数まで表示
  return num.toLocaleString(undefined, { maximumFractionDigits: maxDigits });
}

/**
 * 通貨フォーマット関数
 * @param {number} num - フォーマットする数値
 * @param {string} currency - 通貨コード（例：'JPY', 'USD'）
 * @returns {string} フォーマットされた通貨文字列
 */
function formatCurrency(num, currency = 'JPY') {
  if (num === null || num === undefined) {
    return '0';
  }

  // 通貨に応じて小数点以下の桁数を決定
  const minimumFractionDigits = currency === 'JPY' ? 0 : 2;
  const maximumFractionDigits = currency === 'JPY' ? 0 : 8;

  return num.toLocaleString('ja-JP', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: minimumFractionDigits,
    maximumFractionDigits: maximumFractionDigits
  });
}

/**
 * テーブルヘッダーにツールチップを適用する関数
 */
function applyHeaderTooltips() {
  // テーブルヘッダーに省略クラスとツールチップを追加
  const tableHeaders = document.querySelectorAll('.summary-cards table th');
  tableHeaders.forEach(header => {
    // クラス適用
    header.classList.add('truncate-header');

    // ツールチップ属性を設定
    header.setAttribute('data-bs-toggle', 'tooltip');
    header.setAttribute('data-bs-placement', 'top');
    header.setAttribute('title', header.textContent);
  });

  // Bootstrapツールチップを初期化
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });
}

// DOM読み込み完了時または動的コンテンツ生成後にツールチップを初期化
document.addEventListener('DOMContentLoaded', function() {
  // すでに存在するテーブルヘッダーに適用
  applyHeaderTooltips();

  // タブ切り替え時にも適用（動的に生成される場合）
  const tabElements = document.querySelectorAll('button[data-bs-toggle="tab"]');
  tabElements.forEach(tab => {
    tab.addEventListener('shown.bs.tab', function (e) {
      // タブ切り替え後にツールチップを初期化
      setTimeout(applyHeaderTooltips, 100);
    });
  });
});

// 動的にテーブルが生成される場合、生成後に以下の関数を呼び出す
// 例：テーブルデータ読み込み完了時のコールバック内などで
// applyHeaderTooltips();

/**
 * 購入可能額を表示
 * @param {Object} availableAmounts - 購入可能額データ（戦略別）
 */
// 共通のカードレンダリング関数
function renderCardContainer(containerId, title, icon, items, itemRenderer, emptyMessage) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  let html = '';

  if (items && Object.keys(items).length > 0) {
    html += `
      <div class="col-12 mb-4">
        <div class="card">
          <div class="card-header bg-primary text-white">
            <h5 class="mb-0">
              <i class="${icon}"></i> ${title}
            </h5>
          </div>
          <div class="card-body">
            <div class="row">
    `;

    html += itemRenderer(items);

    html += `
            </div>
          </div>
        </div>
      </div>
    `;
  } else {
    html = `<div class="col-12"><p class="text-center text-muted">${emptyMessage}</p></div>`;
  }

  container.innerHTML = html;
}

function renderAvailableAmounts(availableAmounts) {
  const container = document.getElementById('available-amounts-container');
  if (!container) {
    return;
  }

  let html = '';

  // 戦略別にグループ化して表示
  Object.entries(availableAmounts).forEach(([strategyName, symbols]) => {
    html += `
      <div class="col-12 mb-4">
        <div class="card">
          <div class="card-header bg-primary text-white">
            <h5 class="mb-0">
              <i class="bi bi-graph-up-arrow"></i> ${strategyName}
            </h5>
          </div>
          <div class="card-body">
            <div class="row">
    `;

    // 各通貨ペアの購入可能額を表示
    Object.entries(symbols).forEach(([symbol, data]) => {
      if (data.error) {
        html += createErrorCard(symbol, data.error);
        return;
      }

      html += createAvailableAmountCard(symbol, data);
    });

    html += `
            </div>
          </div>
        </div>
      </div>
    `;
  });

  if (html === '') {
    html = '<div class="col-12"><p class="text-center text-muted">購入可能額データがありません</p></div>';
  }

  container.innerHTML = html;
}

// 共通のエラーカード作成関数
function createErrorCard(symbol, error) {
  return `
    <div class="col-md-6 col-lg-4 mb-3">
      <div class="card h-100 border-danger">
        <div class="card-header bg-danger text-white">
          <h6 class="mb-0">${symbol}</h6>
        </div>
        <div class="card-body">
          <p class="text-danger mb-0">
            <i class="bi bi-exclamation-triangle"></i> エラー: ${error}
          </p>
        </div>
      </div>
    </div>
  `;
}

// 購入可能額カード作成関数
function createAvailableAmountCard(symbol, data) {
  const {
    baseCurrency,
    quoteCurrency,
    availableFunds,
    currentPrice,
    realizedPnL,
    tradePercentage,
    availableAmount,
    availableValue,
    totalAvailableValue,
    minTradeAmount
  } = data;

  // 購入可能かどうかの判定
  const canBuy = availableAmount > (minTradeAmount || 0) && totalAvailableValue > 0;
  const cardClass = canBuy ? 'border-success' : 'border-warning';
  const statusBadge = canBuy
    ? '<span class="badge bg-success">購入可能</span>'
    : '<span class="badge bg-warning">購入不可</span>';

  return `
    <div class="col-md-6 col-lg-4 mb-3">
      <div class="card h-100 ${cardClass}">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h6 class="mb-0">${symbol}</h6>
          ${statusBadge}
        </div>
        <div class="card-body">
          <div class="mb-2">
            <small class="text-muted">現在価格</small>
            <div class="fw-bold">${formatCurrency(currentPrice, baseCurrency)}</div>
          </div>
          
          <div class="mb-2">
            <small class="text-muted">利用可能資金</small>
            <div class="fw-bold">${formatCurrency(availableFunds, baseCurrency)}</div>
          </div>
          
          <div class="mb-2">
            <small class="text-muted">取引割合</small>
            <div class="fw-bold">${tradePercentage.toFixed(1)}%</div>
          </div>
          
          <div class="mb-2">
            <small class="text-muted">実現損益</small>
            <div class="fw-bold ${realizedPnL >= 0 ? 'text-success' : 'text-danger'}">
              ${realizedPnL >= 0 ? '+' : ''}${formatCurrency(realizedPnL, baseCurrency)}
            </div>
          </div>
          
          <hr>
          
          <div class="mb-2">
            <small class="text-muted">購入可能額（実現損益込み）</small>
            <div class="fw-bold text-primary">${formatCurrency(totalAvailableValue, baseCurrency)}</div>
          </div>
          
          <div class="mb-2">
            <small class="text-muted">購入可能数量</small>
            <div class="fw-bold">${availableAmount.toFixed(8)} ${quoteCurrency}</div>
          </div>
          
          ${minTradeAmount ? `
            <div class="mb-2">
              <small class="text-muted">最小取引数量</small>
              <div class="fw-bold">${minTradeAmount.toFixed(8)} ${quoteCurrency}</div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

/**
 * 数量を適切な小数点で表示するためのフォーマット関数
 * @param {number} amount - フォーマットする数量
 * @param {number} precision - 小数点以下の桁数
 * @returns {string} フォーマットされた数量文字列
 */
function formatAmount(amount, precision = 8) {
  if (amount === null || amount === undefined || amount === 0) {
    return '0';
  }

  // 非常に小さい値の場合は科学的記数法を使用
  if (Math.abs(amount) < 0.000001 && amount !== 0) {
    return amount.toExponential(2);
  }

  // 通常の場合は指定された精度でフォーマット
  return parseFloat(amount.toFixed(precision)).toString();
}

/**
 * シンボルからベースアセット（通貨単位）を抽出する関数
 * @param {string} symbol - 通貨ペア（例：BTC/JPY）
 * @returns {string} ベースアセット（例：BTC）
 */
function extractBaseAsset(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    return '';
  }

  const parts = symbol.split('/');
  return parts.length > 0 ? parts[0] : symbol;
}

/**
 * リスク管理ポジション情報を読み込み表示
 */
async function loadAndDisplayRiskPositions() {
  try {
    const response = await fetch('/api/risk-positions');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    renderRiskPositions(data);
  } catch (error) {
    console.error('リスク管理ポジション情報の取得に失敗しました:', error);
    showRiskPositionsError(error.message);
  }
}

/**
 * リスク管理統計情報を読み込み表示
 */
async function loadAndDisplayRiskStats() {
  try {
    const response = await fetch('/api/risk-stats');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    renderRiskStats(data);
  } catch (error) {
    console.error('リスク管理統計情報の取得に失敗しました:', error);
    showRiskStatsError(error.message);
  }
}

/**
 * リスク管理ポジション情報を表示
 * @param {Object} data - リスク管理データ
 */
function renderRiskPositions(data) {
  const container = document.getElementById('risk-positions-container');
  if (!container) {
    return;
  }

  const { positions = [], stats = {} } = data;

  if (positions.length === 0) {
    container.innerHTML = `
      <div class="text-center py-4">
        <i class="bi bi-info-circle text-muted" style="font-size: 2rem;"></i>
        <p class="text-muted mt-2">現在アクティブなリスク管理ポジションはありません。</p>
      </div>
    `;
    return;
  }

  // ポジションをステータスと取引所別にグループ化
  const groupedPositions = {};
  positions.forEach(position => {
    const key = `${position.exchange}_${position.status}`;
    if (!groupedPositions[key]) {
      groupedPositions[key] = [];
    }
    groupedPositions[key].push(position);
  });

  let html = `
    <div class="row mb-3">
      <div class="col-md-3">
        <div class="card bg-primary text-white">
          <div class="card-body text-center">
            <h6 class="card-title">総ポジション数</h6>
            <h4>${stats.totalPositions || 0}</h4>
            <small>約定済: ${stats.filledPositions || 0} / 未約定: ${stats.pendingOrders || 0}</small>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card bg-success text-white">
          <div class="card-body text-center">
            <h6 class="card-title">アクティブ</h6>
            <h4>${stats.activePositions || 0}</h4>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card bg-warning text-white">
          <div class="card-body text-center">
            <h6 class="card-title">リスク状態</h6>
            <h4>${stats.atRiskPositions || 0}</h4>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card bg-info text-white">
          <div class="card-body text-center">
            <h6 class="card-title">未実現損益</h6>
            <h4>${(stats.totalUnrealizedPnL || 0).toLocaleString()}円</h4>
          </div>
        </div>
      </div>
    </div>
  `;

  // ポジション一覧テーブル
  html += `
    <div class="table-responsive">
      <table class="table table-striped table-hover" id="risk-positions-table">
        <thead class="table-dark">
          <tr>
            <th>取引所</th>
            <th>通貨ペア</th>
            <th>戦略</th>
            <th>数量</th>
            <th>エントリー価格</th>
            <th>現在価格</th>
            <th>未実現損益</th>
            <th>経過時間</th>
            <th>ステータス</th>
          </tr>
        </thead>
        <tbody id="risk-positions-tbody">
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;

  // テーブルにデータを挿入（data-sort属性付き）
  const tbody = document.getElementById('risk-positions-tbody');
  if (tbody) {
    tbody.innerHTML = positions.map(position => {
      let statusBadge;
      if (position.status === 'pending') {
        statusBadge = '<span class="badge bg-info">未約定</span>';
      } else if (position.status === 'active') {
        statusBadge = '<span class="badge bg-success">アクティブ</span>';
      } else {
        statusBadge = '<span class="badge bg-warning">リスク状態</span>';
      }

      const pnl = position.unrealizedPnL || 0;
      const pnlPercent = position.unrealizedPnLPercent || 0;
      const pnlClass = pnl >= 0 ? 'text-success' : 'text-danger';
      const pnlPrefix = pnl >= 0 ? '+' : '';

      return `
        <tr>
          <td>${position.exchange || 'N/A'}</td>
          <td><strong>${position.symbol || 'N/A'}</strong></td>
          <td><span class="badge bg-secondary">${position.strategy || 'N/A'}</span></td>
          <td>${formatAmount(position.amount || 0, 6)} ${extractBaseAsset(position.symbol || '')}</td>
          <td>¥${(position.entryPrice || 0).toLocaleString()}</td>
          <td>¥${(position.currentPrice || 0).toLocaleString()}</td>
          <td class="${pnlClass}" data-order="${pnl}"><strong>${pnlPrefix}${pnl.toLocaleString()}円</strong><br><small>(${pnlPrefix}${pnlPercent.toFixed(2)}%)</small></td>
          <td>${(position.elapsedHours || 0).toFixed(1)}時間</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');

    // DataTableを初期化
    initializeRiskPositionsDataTable();
  }
}

// リスク管理ポジションDataTableの初期化
function initializeRiskPositionsDataTable() {
  // DataTableが既に初期化されている場合は破棄
  if (riskPositionsDataTable) {
    riskPositionsDataTable.destroy();
    riskPositionsDataTable = null;
  }

  riskPositionsDataTable = $('#risk-positions-table').DataTable({
    language: {
      url: '//cdn.datatables.net/plug-ins/1.13.1/i18n/ja.json'
    },
    order: [[6, 'desc']], // 未実現損益列で降順ソート
    pageLength: 20,
    responsive: true,
    columnDefs: [
      {
        targets: 6, // 未実現損益の列
        type: 'html-num' // HTMLタグを無視して数値でソート
      }
    ],
    dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>' +
         '<"row"<"col-sm-12"tr>>' +
         '<"row"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>'
  });
}

/**
 * リスク管理統計情報を表示
 * @param {Object} data - 統計データ
 */
function renderRiskStats(data) {
  const container = document.getElementById('risk-stats-container');
  if (!container) {
    return;
  }

  const { exchangeStats = {}, totalPositions = 0, filledPositions = 0, pendingOrders = 0, periodPnL = 0 } = data;

  let html = createStatsRow([
    { title: '期間損益', value: `${periodPnL >= 0 ? '+' : ''}${periodPnL.toLocaleString()}円`, class: periodPnL >= 0 ? 'text-success' : 'text-danger', borderClass: 'border-info' },
    { title: '総リスク管理ポジション数', value: totalPositions, class: 'text-primary', borderClass: 'border-primary', subtitle: `約定済: ${filledPositions} / 未約定: ${pendingOrders}` },
    { title: '未売却ポジション数', value: filledPositions, class: 'text-success', borderClass: 'border-success', subtitle: '約定済みのみ' }
  ]);

  if (Object.keys(exchangeStats).length > 0) {
    html += createExchangeStatsTable(exchangeStats);
  }

  container.innerHTML = html;
}

// 統計カード行作成関数
function createStatsRow(statsData) {
  return `
    <div class="row">
      ${statsData.map(stat => `
        <div class="col-md-4">
          <div class="card ${stat.borderClass}">
            <div class="card-body">
              <h6 class="card-title">${stat.title}</h6>
              <h4 class="${stat.class}">${stat.value}</h4>
              ${stat.subtitle ? `<small class="text-muted">${stat.subtitle}</small>` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// 取引所別統計テーブル作成関数
function createExchangeStatsTable(exchangeStats) {
  const tableRows = Object.entries(exchangeStats).map(([exchange, stats]) => {
    const pnlClass = (stats.unrealizedPnL || 0) >= 0 ? 'text-success' : 'text-danger';
    const pnlPrefix = (stats.unrealizedPnL || 0) >= 0 ? '+' : '';

    return `
      <tr>
        <td><strong>${exchange}</strong></td>
        <td>${stats.positions || 0}</td>
        <td>${formatAmount(stats.totalAmount || 0, 4)}</td>
        <td class="${pnlClass}">${pnlPrefix}${(stats.unrealizedPnL || 0).toLocaleString()}円</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="row mt-3">
      <div class="col-12">
        <h6>取引所別統計</h6>
        <div class="table-responsive">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>取引所</th>
                <th>ポジション数</th>
                <th>総数量</th>
                <th>未実現損益</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

/**
 * リスク管理ポジションエラー表示
 * @param {string} errorMessage - エラーメッセージ
 */
function showRiskPositionsError(errorMessage) {
  const container = document.getElementById('risk-positions-container');
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="alert alert-danger" role="alert">
      <i class="bi bi-exclamation-triangle-fill"></i>
      <strong>エラー:</strong> リスク管理ポジション情報の取得に失敗しました。<br>
      <small>${errorMessage}</small>
    </div>
  `;
}

/**
 * リスク管理統計エラー表示
 * @param {string} errorMessage - エラーメッセージ
 */
function showRiskStatsError(errorMessage) {
  const container = document.getElementById('risk-stats-container');
  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="alert alert-danger" role="alert">
      <i class="bi bi-exclamation-triangle-fill"></i>
      <strong>エラー:</strong> リスク管理統計の取得に失敗しました。<br>
      <small>${errorMessage}</small>
    </div>
  `;
}

/**
 * リスク管理ポジション情報を更新
 */
function refreshRiskPositions() {
  // ローディング状態に戻す
  const positionsContainer = document.getElementById('risk-positions-container');
  const statsContainer = document.getElementById('risk-stats-container');

  if (positionsContainer) {
    positionsContainer.innerHTML = `
      <div class="text-center py-3">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">読み込み中...</span>
        </div>
      </div>
    `;
  }

  if (statsContainer) {
    statsContainer.innerHTML = `
      <div class="text-center py-3">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">読み込み中...</span>
        </div>
      </div>
    `;
  }

  // データを再読み込み
  loadAndDisplayRiskPositions();
  loadAndDisplayRiskStats();
}

/**
 * 未売却ポジションデータの読み込みと表示
 */
async function loadAndDisplayFilledPositions() {
  try {
    const response = await fetch('/api/filled-positions');
    const data = await response.json();

    if (response.ok) {
      displayFilledPositionsStats(data.stats);
      displayFilledPositionsTable(data.positions);
    } else {
      console.error('未売却ポジションの読み込みエラー:', data.error);
      showFilledPositionsError('データの読み込みに失敗しました: ' + data.error);
    }
  } catch (error) {
    console.error('未売却ポジションの読み込みエラー:', error);
    showFilledPositionsError('データの読み込みに失敗しました: ' + error.message);
  }
}

/**
 * 未売却ポジション統計情報の表示
 */
function displayFilledPositionsStats(stats) {
  const totalPositionsElement = document.getElementById('filled-total-positions');
  const totalPnLElement = document.getElementById('filled-total-pnl');
  const avgTimeElement = document.getElementById('filled-avg-time');
  const lastUpdatedElement = document.getElementById('filled-last-updated');

  if (totalPositionsElement) {
    totalPositionsElement.textContent = stats.totalFilledPositions || 0;
  }

  if (totalPnLElement) {
    const totalPnL = stats.totalUnrealizedPnL || 0;
    totalPnLElement.textContent = formatCurrency(totalPnL);
    totalPnLElement.className = totalPnL >= 0 ? 'text-success' : 'text-danger';
  }

  if (avgTimeElement) {
    const avgTime = stats.averageHoldingTime || 0;
    avgTimeElement.textContent = CommonUI.formatHours(avgTime);
  }

  if (lastUpdatedElement) {
    lastUpdatedElement.textContent = formatDateTime(Date.now());
  }
}

/**
 * 未売却ポジションテーブルの表示
 */
function displayFilledPositionsTable(positions) {
  // DataTableが初期化されている場合は破棄
  if (filledPositionsDataTable) {
    filledPositionsDataTable.destroy();
    filledPositionsDataTable = null;
  }

  const tbody = document.getElementById('filled-positions-tbody');

  if (!tbody) {
    return;
  }

  if (!positions || positions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center text-muted">
          未売却ポジションが見つかりません
        </td>
      </tr>
    `;
    return;
  }

  // テーブルにデータを挿入（data-sort属性付き）
  tbody.innerHTML = positions.map(position => {
    const pnl = position.unrealizedPnL || 0;
    const pnlPercent = position.unrealizedPnLPercent || 0;
    const pnlClass = pnl >= 0 ? 'text-success' : 'text-danger';

    // 約定済みポジションの場合は保有時間を使用、そうでなければ経過時間を計算
    const elapsedHours = position.holdingTimeHours ||
                        (position.createdAt && position.closedAt ?
                          (new Date(position.closedAt) - new Date(position.createdAt)) / (1000 * 60 * 60) :
                          (Date.now() - position.timestamp) / (1000 * 60 * 60));

    return `
      <tr>
        <td><small>${position.exchange}</small></td>
        <td><strong>${position.symbol}</strong></td>
        <td><span class="badge bg-secondary">${position.strategy}</span></td>
        <td><span class="badge bg-${position.side === 'buy' ? 'primary' : 'warning'}">${position.side.toUpperCase()}</span></td>
        <td><small>${formatNumber(position.amount)}</small></td>
        <td><small>¥${formatNumber(position.entryPrice)}</small></td>
        <td><small>¥${formatNumber(position.currentPrice)}</small></td>
        <td class="${pnlClass}" data-order="${pnl}"><strong><small>¥${formatNumber(pnl)}</small></strong></td>
        <td class="${pnlClass}" data-order="${pnlPercent}"><strong><small>${formatPercent(pnlPercent)}%</small></strong></td>
        <td><small>${CommonUI.formatHours(elapsedHours)}</small></td>
      </tr>
    `;
  }).join('');

  // DataTableを初期化
  initializeFilledPositionsDataTable();
}

// 未売却ポジションDataTableの初期化
function initializeFilledPositionsDataTable() {
  filledPositionsDataTable = $('#filled-positions-table').DataTable({
    language: {
      url: '//cdn.datatables.net/plug-ins/1.13.1/i18n/ja.json'
    },
    order: [[7, 'desc']], // 未実現損益列で降順ソート
    pageLength: 15,
    responsive: true,
    columnDefs: [
      {
        targets: [7, 8], // 未実現損益と損益率の列
        type: 'html-num' // HTMLタグを無視して数値でソート
      }
    ],
    dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>' +
         '<"row"<"col-sm-12"tr>>' +
         '<"row"<"col-sm-12 col-md-5"i><"col-sm-12 col-md-7"p>>'
  });
}

/**
 * 未売却ポジションエラー表示
 */
function showFilledPositionsError(message) {
  const tbody = document.getElementById('filled-positions-tbody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center text-danger">
          <i class="fas fa-exclamation-triangle"></i> ${message}
        </td>
      </tr>
    `;
  }
}

/**
 * 通貨フォーマット
 */
function formatCurrency(value) {
  return `¥${formatNumber(value)}`;
}

/**
 * パーセント フォーマット
 */
function formatPercent(value) {
  if (typeof value !== 'number') {
    return '-';
  }
  return value.toFixed(2);
}

/**
 * 時間フォーマット
 */
// formatHours function moved to common-ui.js to eliminate duplication

/**
 * 日時フォーマット
 */
function formatDateTime(timestamp) {
  if (!timestamp) {
    return '-';
  }
  const date = new Date(timestamp);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}/* Updated at Tue Jun 17 17:22:18 UTC 2025 */
/* Volume test - Tue Jun 17 17:27:28 UTC 2025 */
