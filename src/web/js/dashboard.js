/**
 * ダッシュボード画面の機能を制御するスクリプト
 */

// グローバル変数
let currentPeriod = 'all';
let profitChart = null;

// 初期化関数
function initDashboard() {
  console.log('ダッシュボードの初期化を開始します');
  
  // 初期データ読み込み
  loadDashboardData();
  
  // 期間ボタンのイベントリスナー設定
  document.querySelectorAll('.period-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      const period = e.target.getAttribute('data-period');
      setActivePeriod(period);
      loadDashboardData();
    });
  });
  
  // リアルタイム更新の設定
  setupRealtimeUpdates();
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
 * アクティブな期間を設定
 * @param {string} period - 期間（daily, weekly, monthly, yearly, all）
 */
function setActivePeriod(period) {
  currentPeriod = period;
  
  // ボタンのアクティブ状態を更新
  document.querySelectorAll('.period-btn').forEach(btn => {
    if (btn.getAttribute('data-period') === period) {
      btn.classList.remove('btn-outline-primary');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline-primary');
    }
  });
}

/**
 * ダッシュボードの全データを読み込む
 */
function loadDashboardData() {
  loadPositions();
  loadSummary();
  loadRecentTrades();
}

/**
 * ポジション情報を読み込んで表示
 */
function loadPositions() {
  const container = document.getElementById('positions-container');
  
  // ローディング表示
  container.innerHTML = `
    <div class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">読み込み中...</span>
      </div>
    </div>
  `;
  
  // APIからデータ取得
  fetch('/api/positions')
    .then(response => response.json())
    .then(data => {
      if (!data.positions || data.positions.length === 0) {
        container.innerHTML = `
          <div class="no-data-message">
            <p>現在のポジションはありません</p>
          </div>
        `;
        return;
      }
      
      // ポジションカードを表示
      let html = '';
      data.positions.forEach(position => {
        const isPositive = position.realizedPnL > 0;
        const cardClass = isPositive ? 'positive' : position.realizedPnL < 0 ? 'negative' : '';
        
        html += `
          <div class="position-summary ${cardClass} mb-2 p-2 border rounded" id="position-summary-${position.exchangeId}-${position.symbol.replace('/', '-')}-${position.strategyKey}">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <strong>${position.symbol}</strong>
                <small class="text-muted ms-2">${position.exchangeId} - ${position.strategyKey}</small>
              </div>
              <span class="badge ${isPositive ? 'bg-success' : position.realizedPnL < 0 ? 'bg-danger' : 'bg-secondary'}">
                ${position.realizedPnL !== null && position.realizedPnL !== undefined ? position.realizedPnL.toLocaleString() : '0'} 円
              </span>
            </div>
          </div>
        `;
      });
      
      container.innerHTML = html;
    })
    .catch(error => {
      console.error('ポジション情報の取得に失敗しました:', error);
      container.innerHTML = `
        <div class="alert alert-danger" role="alert">
          ポジション情報の取得に失敗しました。詳細はコンソールを確認してください。
        </div>
      `;
    });
}

/**
 * サマリー情報を読み込んで表示
 */
function loadSummary() {
  // 取引所別サマリーコンテナ
  const exchangeContainer = document.getElementById('exchange-summary-container');
  // 戦略別サマリーコンテナ
  const strategyContainer = document.getElementById('strategy-summary-container');
  
  // ローディング表示
  exchangeContainer.innerHTML = `
    <div class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">読み込み中...</span>
      </div>
    </div>
  `;
  strategyContainer.innerHTML = exchangeContainer.innerHTML;
  
  // APIからデータ取得
  fetch(`/api/summary?period=${currentPeriod}`)
    .then(response => response.json())
    .then(data => {
      // 取引所別サマリーを表示
      displayExchangeSummary(data, exchangeContainer);
      
      // 戦略別サマリーを表示
      displayStrategySummary(data, strategyContainer);
      
      // 累積損益グラフを更新
      updateProfitChart(data);
    })
    .catch(error => {
      console.error('サマリー情報の取得に失敗しました:', error);
      const errorHtml = `
        <div class="alert alert-danger" role="alert">
          サマリー情報の取得に失敗しました。詳細はコンソールを確認してください。
        </div>
      `;
      exchangeContainer.innerHTML = errorHtml;
      strategyContainer.innerHTML = errorHtml;
    });
}

/**
 * 取引所別サマリーを表示
 * @param {Object} data - APIから取得したサマリーデータ
 * @param {HTMLElement} container - 表示するコンテナ要素
 */
function displayExchangeSummary(data, container) {
  if (!data.byExchange || Object.keys(data.byExchange).length === 0) {
    container.innerHTML = `
      <div class="no-data-message">
        <p>表示するデータがありません</p>
      </div>
    `;
    return;
  }
  
  let html = '<table class="summary-table">';
  html += `
    <thead>
      <tr>
        <th>取引所</th>
        <th>買い量</th>
        <th>売り量</th>
        <th>実現損益</th>
      </tr>
    </thead>
    <tbody>
  `;
  
  // 各取引所のデータを表示
  Object.keys(data.byExchange).forEach(exchangeId => {
    const exchange = data.byExchange[exchangeId];
    const pnlClass = exchange.realizedPnL > 0 ? 'profit' : exchange.realizedPnL < 0 ? 'loss' : '';
    
    html += `
      <tr>
        <td>${exchangeId}</td>
        <td>${exchange.totalBuyAmount.toFixed(6)}</td>
        <td>${exchange.totalSellAmount.toFixed(6)}</td>
        <td class="${pnlClass}">${exchange.realizedPnL !== null && exchange.realizedPnL !== undefined ? exchange.realizedPnL.toLocaleString() : '0'} 円</td>
      </tr>
    `;
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

/**
 * 戦略別サマリーを表示
 * @param {Object} data - APIから取得したサマリーデータ
 * @param {HTMLElement} container - 表示するコンテナ要素
 */
function displayStrategySummary(data, container) {
  if (!data.byStrategy || Object.keys(data.byStrategy).length === 0) {
    container.innerHTML = `
      <div class="no-data-message">
        <p>表示するデータがありません</p>
      </div>
    `;
    return;
  }
  
  let html = '<table class="summary-table">';
  html += `
    <thead>
      <tr>
        <th>戦略</th>
        <th>買い量</th>
        <th>売り量</th>
        <th>実現損益</th>
      </tr>
    </thead>
    <tbody>
  `;
  
  // 各戦略のデータを表示
  Object.keys(data.byStrategy).forEach(strategyKey => {
    const strategy = data.byStrategy[strategyKey];
    const pnlClass = strategy.realizedPnL > 0 ? 'profit' : strategy.realizedPnL < 0 ? 'loss' : '';
    
    html += `
      <tr>
        <td>${strategyKey}</td>
        <td>${strategy.totalBuyAmount.toFixed(6)}</td>
        <td>${strategy.totalSellAmount.toFixed(6)}</td>
        <td class="${pnlClass}">${strategy.realizedPnL !== null && strategy.realizedPnL !== undefined ? strategy.realizedPnL.toLocaleString() : '0'} 円</td>
      </tr>
    `;
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

/**
 * 累積損益グラフを更新
 * @param {Object} data - APIから取得したサマリーデータ
 */
function updateProfitChart(data) {
  const canvas = document.getElementById('profitChart');
  const ctx = canvas.getContext('2d');
  
  // キャンバスの高さを固定
  canvas.style.height = '250px';
  canvas.height = 250;
  
  // 既存のグラフがあれば破棄
  if (profitChart) {
    profitChart.destroy();
  }
  
  // 新しいグラフを作成（Chart.jsが読み込まれているか確認）
  if (typeof Chart === 'undefined') {
    console.error('Chart.jsが読み込まれていません。グラフは表示できません。');
    return;
  }
  
  profitChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['累積'],
      datasets: [
        {
          label: '実現損益',
          data: [data.summary.realizedPnL],
          backgroundColor: data.summary.realizedPnL >= 0 ? 'rgba(40, 167, 69, 0.5)' : 'rgba(220, 53, 69, 0.5)',
          borderColor: data.summary.realizedPnL >= 0 ? 'rgb(40, 167, 69)' : 'rgb(220, 53, 69)',
          borderWidth: 1
        },
        {
          label: '現在のポジション価値',
          data: [data.summary.currentPositionValue],
          backgroundColor: 'rgba(0, 123, 255, 0.5)',
          borderColor: 'rgb(0, 123, 255)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true, // アスペクト比を維持
      height: 250, // 高さを固定
      animation: {
        duration: 0 // アニメーションを無効化して再描画時の問題を防止
      },
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
        title: {
          display: true,
          text: `累積損益サマリー (${getPeriodText(currentPeriod)})`
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${context.raw !== null && context.raw !== undefined ? context.raw.toLocaleString() : '0'} 円`;
            }
          }
        }
      }
    }
  });
}

/**
 * 期間テキストを取得
 * @param {string} period - 期間キー
 * @returns {string} - 表示用のテキスト
 */
function getPeriodText(period) {
  switch (period) {
    case 'daily': return '24時間';
    case 'weekly': return '1週間';
    case 'monthly': return '1ヶ月';
    case 'yearly': return '1年間';
    case 'all': 
    default: return '全期間';
  }
}

/**
 * 最近の取引を読み込んで表示
 */
function loadRecentTrades() {
  const tableBody = document.querySelector('#recent-trades-table tbody');
  
  // APIからデータ取得
  fetch('/api/history?limit=50')
    .then(response => response.json())
    .then(data => {
      if (!data.history || data.history.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="8" class="text-center">取引データがありません</td>
          </tr>
        `;
        return;
      }
      
      // テーブルを更新
      let html = '';
      data.history.forEach(trade => {
        html += createTradeTableRow(trade);
      });
      
      tableBody.innerHTML = html;
    })
    .catch(error => {
      console.error('取引履歴の取得に失敗しました:', error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" class="text-center text-danger">
            取引履歴の取得に失敗しました。詳細はコンソールを確認してください。
          </td>
        </tr>
      `;
    });
}

/**
 * 取引データからテーブル行のHTMLを生成
 * @param {Object} trade - 取引データ
 * @returns {string} - HTML文字列
 */
function createTradeTableRow(trade) {
  const date = new Date(trade.timestamp);
  const formattedDate = date.toLocaleString('ja-JP');
  const sideClass = trade.side === 'buy' ? 'buy-trade' : 'sell-trade';
  
  return `
    <tr>
      <td>${formattedDate}</td>
      <td>${trade.exchangeId}</td>
      <td>${trade.symbol}</td>
      <td>${trade.strategyKey}</td>
      <td class="${sideClass}">${trade.side === 'buy' ? '買い' : '売り'}</td>
      <td>${trade.amount}</td>
      <td>${trade.price !== null && trade.price !== undefined ? trade.price.toLocaleString() : '0'}</td>
      <td>${trade.value !== null && trade.value !== undefined ? trade.value.toLocaleString() : '0'}</td>
    </tr>
  `;
}

/**
 * リアルタイム更新の設定
 */
function setupRealtimeUpdates() {
  // 取引追加イベント
  realtimeUpdater.addListener('trade_added', (tradeData) => {
    // 最近の取引テーブルに追加
    addTradeToRecentTable(tradeData);
    
    // ポジションとサマリーを更新（重複更新を避けるため遅延実行）
    debounceUpdate();
  });
  
  // バッチ更新イベント
  realtimeUpdater.addListener('batch_update', (updates) => {
    // 最近の取引テーブルを更新
    if (Array.isArray(updates)) {
      updates.forEach(update => {
        if (update.type === 'trade_added') {
          addTradeToRecentTable(update.data);
        }
      });
    }
    
    // ポジションとサマリーを更新
    debounceUpdate();
  });
}

// 短時間の重複更新を避けるための遅延処理
let updateTimeout = null;
function debounceUpdate() {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    loadPositions();
    loadSummary();
  }, 1000);
}

/**
 * 最近の取引テーブルに新しい取引を追加
 * @param {Object} trade - 追加する取引データ
 */
function addTradeToRecentTable(trade) {
  const tableBody = document.querySelector('#recent-trades-table tbody');
  
  // 「データなし」の行がある場合は削除
  const noDataRow = tableBody.querySelector('td[colspan="8"]');
  if (noDataRow) {
    tableBody.innerHTML = '';
  }
  
  // 新しい行を作成して先頭に追加
  const newRow = document.createElement('tr');
  newRow.innerHTML = createTradeTableRow(trade);
  
  if (tableBody.firstChild) {
    tableBody.insertBefore(newRow, tableBody.firstChild);
  } else {
    tableBody.appendChild(newRow);
  }
  
  // 最大50行に制限
  while (tableBody.children.length > 50) {
    tableBody.removeChild(tableBody.lastChild);
  }
}