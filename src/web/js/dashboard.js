/**
 * ダッシュボード画面の機能を制御するスクリプト
 */

// グローバル変数
let currentOrderPairs = []; // 注文ペアデータを保持
let currentSymbolFilter = 'all'; // 選択中の銘柄フィルタ

/**
 * 初期化関数
 */
function initDashboard() {
  console.log('ダッシュボードの初期化を開始します');

  // サマリーデータの読み込みと表示
  loadAndDisplaySummary();

  // タブ切り替えイベントリスナー設定
  const summaryTabs = document.getElementById('summaryTabs');
  if (summaryTabs) {
    summaryTabs.addEventListener('shown.bs.tab', function (event) {
      // アクティブになったタブのIDを取得
      const activeTabId = event.target.id;
      console.log(`タブが切り替えられました: ${activeTabId}`);

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
    const processedData = processSummaryData(data);

    // 各セクションの表示
    renderExchangeSummary(processedData.byExchange);
    renderSymbolSummary(processedData.bySymbol); // 銘柄別サマリーのレンダリングを追加
    renderStrategySummary(processedData.byStrategy);
    renderOrderPairsSummary(processedData.orderPairs); // 注文ペアサマリーのレンダリングを再度追加

    // ローディング表示を非表示にしてコンテンツを表示
    if (loadingElement) loadingElement.classList.add('d-none');
    if (containerElement) containerElement.classList.remove('d-none');

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

  // 配列データであることを確認
  if (!Array.isArray(data)) {
    console.error('APIレスポンスが期待される配列形式ではありません:', data);
    // エラー処理または空のデータを返すなどの対応
    return result;
  }

  // 注文ペアデータとして元データを保存
  result.orderPairs = data;
  currentOrderPairs = data; // グローバル変数に保存

  // 各エントリを処理して集計
  data.forEach(entry => {
    const { exchangeId, symbol, strategyKey, totalBuyCost, totalSellValue, totalFee, realizedPnL } = entry;

    // 取引所データの集計と内訳の保持
    if (!result.byExchange[exchangeId]) {
      result.byExchange[exchangeId] = {
        totalBuyCost: 0,
        totalSellValue: 0,
        totalFee: 0,
        realizedPnL: 0,
        netPnL: 0,
        bySymbol: {}, // 銘柄別の内訳
        byStrategy: {} // 戦略別の内訳
      };
    }
    result.byExchange[exchangeId].totalBuyCost += totalBuyCost || 0;
    result.byExchange[exchangeId].totalSellValue += totalSellValue || 0;
    result.byExchange[exchangeId].totalFee += totalFee || 0;
    result.byExchange[exchangeId].realizedPnL += realizedPnL || 0;

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
        byExchange: {}, // 取引所別の内訳
        byStrategy: {} // 戦略別の内訳
      };
    }
    result.bySymbol[symbol].totalBuyCost += totalBuyCost || 0;
    result.bySymbol[symbol].totalSellValue += totalSellValue || 0;
    result.bySymbol[symbol].totalFee += totalFee || 0;
    result.bySymbol[symbol].realizedPnL += realizedPnL || 0;

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
 * 取引所別サマリーを表示する
 * @param {Object} exchangeData - 取引所別にグループ化されたデータ（内訳含む）
 */
function renderExchangeSummary(exchangeData) {
  const container = document.getElementById('exchange-summary-container');
  if (!container) return;

  // データがない場合
  if (!exchangeData || Object.keys(exchangeData).length === 0) {
    container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
    return;
  }

  // データを実現損益順にソート
  const sortedExchanges = Object.entries(exchangeData)
    .map(([exchangeId, data]) => ({ exchangeId, ...data }))
    .sort((a, b) => b.netPnL - a.netPnL); // 純損益の降順でソート

  let html = '';

  // 各取引所のカードを生成
  sortedExchanges.forEach(data => {
    const netPnlClass = data.netPnL > 0 ? 'text-success' : data.netPnL < 0 ? 'text-danger' : '';
    const exchangeId = data.exchangeId;

    html += `
    <div class="col-md-6 col-lg-4 mb-3">
      <div class="card h-100 summary-card-clickable"> <!-- クリック可能クラスを追加 -->
        <div class="card-header">
          <h6 class="mb-0">${exchangeId}</h6>
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
              </tr>
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
          <div class="breakdown-container" id="exchange-${exchangeId}-breakdown" style="display: none;">
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
          const exchangeId = this.querySelector('.card-header h6').innerText; // 取引所IDを取得
          const data = exchangeData[exchangeId]; // 対応するデータを取得

          if (breakdownContainer) {
              // 表示/非表示をトグル
              if (breakdownContainer.style.display === 'none') {
                  breakdownContainer.style.display = 'block';
                  // グラフと表を描画
                  renderBreakdownGraphAndTable(data.bySymbol, '銘柄別内訳', breakdownContainer.id);
                  renderBreakdownGraphAndTable(data.byStrategy, '戦略別内訳', breakdownContainer.id);
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
 * 銘柄別サマリーを表示する
 * @param {Object} symbolData - 銘柄別にグループ化されたデータ（内訳含む）
 */
function renderSymbolSummary(symbolData) {
  const container = document.getElementById('symbol-summary-container');
  if (!container) return;

  // データがない場合
  if (!symbolData || Object.keys(symbolData).length === 0) {
    container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
    return;
  }

  // データを実現損益順にソート
  const sortedSymbols = Object.entries(symbolData)
    .map(([symbol, data]) => ({ symbol, ...data }))
    .sort((a, b) => b.netPnL - a.netPnL); // 純損益の降順でソート

  let html = '';

  // 各銘柄のカードを生成
  sortedSymbols.forEach(data => {
    const netPnlClass = data.netPnL > 0 ? 'text-success' : data.netPnL < 0 ? 'text-danger' : '';
    const symbol = data.symbol;

    html += `
    <div class="col-md-6 col-lg-4 mb-3">
      <div class="card h-100 summary-card-clickable"> <!-- クリック可能クラスを追加 -->
        <div class="card-header">
          <h6 class="mb-0">${symbol}</h6>
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
              </tr>
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
          <div class="breakdown-container" id="symbol-${symbol}-breakdown" style="display: none;">
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
          const symbol = this.querySelector('.card-header h6').innerText; // 銘柄を取得
          const data = symbolData[symbol]; // 対応するデータを取得

          if (breakdownContainer) {
              // 表示/非表示をトグル
              if (breakdownContainer.style.display === 'none') {
                  breakdownContainer.style.display = 'block';
                  // グラフと表を描画
                  renderBreakdownGraphAndTable(data.byExchange, '取引所別内訳', breakdownContainer.id);
                  renderBreakdownGraphAndTable(data.byStrategy, '戦略別内訳', breakdownContainer.id);
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
 * 戦略別サマリーを表示する
 * @param {Object} strategyData - 戦略別にグループ化されたデータ（内訳含む）
 */
function renderStrategySummary(strategyData) {
  const container = document.getElementById('strategy-summary-container');
  if (!container) return;

  // データがない場合
  if (!strategyData || Object.keys(strategyData).length === 0) {
    container.innerHTML = '<div class="col-12"><div class="alert alert-info">表示するデータがありません</div></div>';
    return;
  }

  // データを実現損益順にソート
  const sortedStrategies = Object.entries(strategyData)
    .map(([strategyKey, data]) => ({ strategyKey, ...data }))
    .sort((a, b) => b.netPnL - a.netPnL); // 純損益の降順でソート

  let html = '';

  // 各戦略のカードを生成
  sortedStrategies.forEach(data => {
    const netPnlClass = data.netPnL > 0 ? 'text-success' : data.netPnL < 0 ? 'text-danger' : '';
    const strategyKey = data.strategyKey;

    html += `
    <div class="col-md-6 col-lg-4 mb-3">
      <div class="card h-100 summary-card-clickable"> <!-- クリック可能クラスを追加 -->
        <div class="card-header">
          <h6 class="mb-0">${strategyKey}</h6>
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
              </tr>
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
          <div class="breakdown-container" id="strategy-${strategyKey}-breakdown" style="display: none;">
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
          const strategyKey = this.querySelector('.card-header h6').innerText; // 戦略キーを取得
          const data = strategyData[strategyKey]; // 対応するデータを取得

          if (breakdownContainer) {
              // 表示/非表示をトグル
              if (breakdownContainer.style.display === 'none') {
                  breakdownContainer.style.display = 'block';
                  // グラフと表を描画
                  renderBreakdownGraphAndTable(data.byExchange, '取引所別内訳', breakdownContainer.id);
                  renderBreakdownGraphAndTable(data.bySymbol, '銘柄別内訳', breakdownContainer.id);
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
 * 注文ペアサマリーを表示する
 * @param {Array} orderPairs - 注文ペアデータの配列
 */
function renderOrderPairsSummary(orderPairs) {
  const container = document.getElementById('order-pairs-summary-container');
  if (!container) return;

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
      if (!timestamp) return '-';
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
      switch(status) {
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
 * 注文ペア用の銘柄ドロップダウンを更新
 * @param {Array} orderPairs - 注文ペアデータの配列
 */
function updateOrderPairSymbolDropdown(orderPairs) {
  const dropdown = document.getElementById('order-pair-symbol-filter');
  if (!dropdown || !orderPairs || orderPairs.length === 0) return;

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
 * @returns {string} - フォーマットされた数値文字列
 */
function formatNumber(num) {
  if (num === null || num === undefined) return '0';

  // 大きな数値の場合は小数点以下を省略
  if (Math.abs(num) >= 1000) {
    return Math.round(num).toLocaleString();
  }

  // 小さな数値の場合は小数点以下1桁まで表示
  return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
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