/**
 * ダッシュボード画面の機能を制御するスクリプト
 */

// グローバル変数
let currentPeriod = 'daily';
let profitChart = null;
let allOrderPairs = []; // すべての注文ペアデータを保持
let currentSymbolFilter = 'all'; // 現在選択されている銘柄フィルタ

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
  
  // ポジションタブのイベントリスナー設定
  document.querySelectorAll('#positionTabs .nav-link').forEach(tab => {
    tab.addEventListener('click', function(e) {
      // タブIDからアクティブなタブを更新
      const tabId = e.target.id;
      if (tabId === 'exchange-tab') activePositionTab = 'exchange';
      else if (tabId === 'symbol-tab') activePositionTab = 'symbol';
      else if (tabId === 'strategy-tab') activePositionTab = 'strategy';
    });
  });
  
  // 銘柄フィルターの設定
  setupSymbolFilter();
  
  // リアルタイム更新の設定
  setupRealtimeUpdates();
}

/**
 * 銘柄フィルターのセットアップ
 */
function setupSymbolFilter() {
  const symbolFilter = document.getElementById('symbol-filter');
  if (symbolFilter) {
    symbolFilter.addEventListener('change', function() {
      currentSymbolFilter = this.value;
      displayFilteredOrderPairs();
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
  loadOrderPairsSummary(); // 注文ペアサマリーを読み込む
  loadRecentTrades();
}

/**
* ポジション情報を読み込んで表示
*/
// ポジション表示に関するグローバル変数
let allPositions = []; // すべてのポジションデータを保持
let currentPositionPage = 1; // 現在のページ（旧方式用）
const positionsPerPage = 7; // 1ページあたりの表示件数（旧方式用）
let activePositionTab = 'exchange'; // アクティブなタブ：'exchange', 'symbol', 'strategy'
function loadPositions() {
  // 各タブのコンテナに読み込み中の表示
  const loadingHTML = `
    <div class="text-center py-3">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">読み込み中...</span>
      </div>
    </div>
  `;
  
  document.getElementById('positions-container-exchange').innerHTML = loadingHTML;
  document.getElementById('positions-container-symbol').innerHTML = loadingHTML;
  document.getElementById('positions-container-strategy').innerHTML = loadingHTML;
  
  // APIからデータ取得
  fetch('/api/positions')
    .then(response => response.json())
    .then(data => {
      if (!data.positions || data.positions.length === 0) {
        const noDataHTML = `
          <div class="no-data-message">
            <p>現在のポジションはありません</p>
          </div>
        `;
        document.getElementById('positions-container-exchange').innerHTML = noDataHTML;
        document.getElementById('positions-container-symbol').innerHTML = noDataHTML;
        document.getElementById('positions-container-strategy').innerHTML = noDataHTML;
        return;
      }
      
      // 全ポジションデータをグローバル変数に保存
      allPositions = data.positions;
      
      // 新しいグループ化表示メソッドで表示
      displayGroupedPositions();
      
      // 旧方式の表示も維持（現在は非表示）
      // 現在のページを1ページ目に戻す
      currentPositionPage = 1;
      
      // ポジションの表示を更新（旧方式）
      // 互換性のために残しておく
      // displayPositionsPage();
    })
    .catch(error => {
      console.error('ポジション情報の取得に失敗しました:', error);
      const errorHTML = `
        <div class="alert alert-danger" role="alert">
          ポジション情報の取得に失敗しました。詳細はコンソールを確認してください。
        </div>
      `;
      document.getElementById('positions-container-exchange').innerHTML = errorHTML;
      document.getElementById('positions-container-symbol').innerHTML = errorHTML;
      document.getElementById('positions-container-strategy').innerHTML = errorHTML;
    });
}

/**
 * ポジションの特定ページを表示
 */
function displayPositionsPage() {
  const container = document.getElementById('positions-container');
  const paginationContainer = document.getElementById('positions-pagination');
  
  // 表示するポジションの範囲を計算
  const startIndex = (currentPositionPage - 1) * positionsPerPage;
  const endIndex = Math.min(startIndex + positionsPerPage, allPositions.length);
  const currentPagePositions = allPositions.slice(startIndex, endIndex);
  
  // ポジションカードを表示
  let html = '';
  currentPagePositions.forEach(position => {
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
  
  // ページネーションを更新
  updatePositionsPagination();
}

/**
 * ポジションデータを取引所、通貨、戦略別にグループ化して表示
 */
function displayGroupedPositions() {
  // データが空の場合の処理
  if (allPositions.length === 0) {
    document.getElementById('positions-container-exchange').innerHTML = '<div class="no-data-message"><p>現在のポジションはありません</p></div>';
    document.getElementById('positions-container-symbol').innerHTML = '<div class="no-data-message"><p>現在のポジションはありません</p></div>';
    document.getElementById('positions-container-strategy').innerHTML = '<div class="no-data-message"><p>現在のポジションはありません</p></div>';
    return;
  }
  
  // タブに応じたデータのグループ化
  const byExchange = groupPositionsByKey(allPositions, 'exchangeId');
  const bySymbol = groupPositionsByKey(allPositions, 'symbol');
  const byStrategy = groupPositionsByKey(allPositions, 'strategyKey');
  
  // 各タブのコンテンツを更新
  displayPositionGroupContent('positions-container-exchange', byExchange);
  displayPositionGroupContent('positions-container-symbol', bySymbol);
  displayPositionGroupContent('positions-container-strategy', byStrategy);
  
  // タブのイベントリスナーを設定
  setupPositionTabListeners();
}

/**
 * ポジションデータを特定のキーでグループ化する
 * @param {Array} positions - ポジションデータの配列
 * @param {string} key - グループ化するキー
 * @returns {Object} - グループ化されたポジションデータ
 */
function groupPositionsByKey(positions, key) {
  const grouped = {};
  
  positions.forEach(position => {
    const groupKey = position[key];
    if (!grouped[groupKey]) {
      grouped[groupKey] = [];
    }
    grouped[groupKey].push(position);
  });
  
  return grouped;
}

/**
 * グループ化されたポジションをコンテナに表示
 * @param {string} containerId - 表示するコンテナのID
 * @param {Object} groupedData - グループ化されたポジションデータ
 */
function displayPositionGroupContent(containerId, groupedData) {
  const container = document.getElementById(containerId);
  let html = '';
  
  // グループごとにポジションを表示
  Object.keys(groupedData).forEach(groupKey => {
    const positions = groupedData[groupKey];
    const totalPnL = positions.reduce((sum, pos) => sum + (pos.realizedPnL || 0), 0);
    const totalFee = positions.reduce((sum, pos) => sum + (pos.totalFee || 0), 0); // 手数料合計を計算
    const isPositive = totalPnL > 0;
    const badgeClass = isPositive ? 'bg-success' : totalPnL < 0 ? 'bg-danger' : 'bg-secondary';
    
    // ユニークなIDを生成
    const groupId = `group-${containerId}-${groupKey.replace(/[^a-zA-Z0-9]/g, '-')}`;
    
    html += `
      <div class="position-group mb-2">
        <div class="position-group-header" data-bs-toggle="collapse" data-bs-target="#${groupId}">
          <h6>
            ${groupKey}
            <span>
              <span class="badge rounded-pill ${badgeClass} me-2">${totalPnL.toLocaleString()} 円</span>
              <span class="text-muted me-2">(${totalFee.toLocaleString()})</span> <!-- 手数料合計を括弧で囲んで追加 -->
              <span class="badge bg-secondary">${positions.length}</span>
            </span>
          </h6>
        </div>
        <div class="collapse" id="${groupId}">
          <div class="p-2">
    `;
    
    // グループ内の各ポジションを表示
    positions.forEach(position => {
      const isPositive = position.netPnL > 0; // 合算損益で色分け
      const cardClass = isPositive ? 'positive' : position.netPnL < 0 ? 'negative' : ''; // 合算損益で色分け
      
      html += `
        <div class="position-summary ${cardClass} mb-2 p-2 border rounded">
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <strong>${position.symbol}</strong>
              <small class="text-muted ms-2">${position.exchangeId} - ${position.strategyKey}</small>
            </div>
            <div class="d-flex align-items-center"> <!-- d-flex と align-items-center を追加 -->
              <span class="badge ${position.realizedPnL > 0 ? 'bg-success' : position.realizedPnL < 0 ? 'bg-danger' : 'bg-secondary'} me-1">
                ${position.realizedPnL !== null && position.realizedPnL !== undefined ? position.realizedPnL.toLocaleString() : '0'}
              </span>
              +
              <span class="badge bg-info text-dark mx-1"> <!-- me-1 を mx-1 に変更して左右にマージン -->
                ${position.totalFee !== null && position.totalFee !== undefined ? position.totalFee.toLocaleString() : '0'}
              </span>
              =
              <span class="badge ${isPositive ? 'bg-success' : position.netPnL < 0 ? 'bg-danger' : 'bg-secondary'} ms-1"> <!-- マージンを追加 -->
                ${position.netPnL !== null && position.netPnL !== undefined ? position.netPnL.toLocaleString() : '0'} 円
              </span>
            </div>
          </div>
        </div>
      `;
    });
    
    html += `
          </div>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

/**
 * ポジションタブのイベントリスナーを設定
 */
function setupPositionTabListeners() {
  document.querySelectorAll('#positionTabs .nav-link').forEach(tab => {
    tab.addEventListener('click', function(e) {
      // タブIDからアクティブなタブを更新
      const tabId = e.target.id;
      if (tabId === 'exchange-tab') activePositionTab = 'exchange';
      else if (tabId === 'symbol-tab') activePositionTab = 'symbol';
      else if (tabId === 'strategy-tab') activePositionTab = 'strategy';
    });
  });
}

/**
 * ポジションのページネーションを更新
 */
function updatePositionsPagination() {
  const paginationContainer = document.getElementById('positions-pagination');
  
  // 総ページ数を計算
  const totalPages = Math.ceil(allPositions.length / positionsPerPage);
  
  if (totalPages <= 1) {
    // ページが1つしかない場合はページネーション非表示
    paginationContainer.innerHTML = '';
    return;
  }
  
  let paginationHtml = `
    <nav aria-label="ポジションページネーション">
      <ul class="pagination pagination-sm justify-content-center mb-0">
  `;
  
  // 前へボタン
  paginationHtml += `
    <li class="page-item ${currentPositionPage === 1 ? 'disabled' : ''}">
      <a class="page-link" href="#" data-page="${currentPositionPage - 1}" aria-label="前へ">
        <span aria-hidden="true">&laquo;</span>
      </a>
    </li>
  `;
  
  // ページ番号
  for (let i = 1; i <= totalPages; i++) {
    paginationHtml += `
      <li class="page-item ${i === currentPositionPage ? 'active' : ''}">
        <a class="page-link" href="#" data-page="${i}">${i}</a>
      </li>
    `;
  }
  
  // 次へボタン
  paginationHtml += `
    <li class="page-item ${currentPositionPage === totalPages ? 'disabled' : ''}">
      <a class="page-link" href="#" data-page="${currentPositionPage + 1}" aria-label="次へ">
        <span aria-hidden="true">&raquo;</span>
      </a>
    </li>
  `;
  
  paginationHtml += `
      </ul>
    </nav>
  `;
  
  paginationContainer.innerHTML = paginationHtml;
  
  // ページネーションのクリックイベントを設定
  document.querySelectorAll('#positions-pagination .page-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = parseInt(e.target.getAttribute('data-page') || e.target.parentElement.getAttribute('data-page'));
      if (!isNaN(page) && page > 0 && page <= totalPages) {
        currentPositionPage = page;
        displayPositionsPage();
      }
    });
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
      // デバッグ用：APIレスポンスをコンソールに出力
      console.log('サマリーデータ:', data);
      
      // 手数料が含まれていない場合は0を設定
      if (data.summary && data.summary.totalFee === undefined) {
        data.summary.totalFee = 0;
        console.warn('手数料データが見つかりません。0を設定します。');
      }
      
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
  
  // テーブルをレスポンシブコンテナで囲む
  let html = '<div class="table-responsive"><table class="summary-table table-sm">';
  html += `
    <thead>
      <tr>
        <th>取引所</th>
        <th>買った額</th>
        <th>売った額</th>
        <th>手数料</th>
        <th>実現損益</th>
        <th>純損益</th>
      </tr>
    </thead>
    <tbody>
  `;
  
  // 各取引所のデータを表示
  Object.keys(data.byExchange).forEach(exchangeId => {
    const exchange = data.byExchange[exchangeId];
    const pnlClass = exchange.realizedPnL > 0 ? 'profit' : exchange.realizedPnL < 0 ? 'loss' : '';
    const netPnlClass = exchange.netPnL > 0 ? 'profit' : exchange.netPnL < 0 ? 'loss' : '';
    
    // 数値を短く表示するためのフォーマット関数
    const formatNumber = (num) => {
      if (num === null || num === undefined) return '0';
      // 1000以上の場合は小数点以下を省略
      if (Math.abs(num) >= 1000) {
        return Math.round(num).toLocaleString();
      }
      // 1000未満の場合は小数点以下1桁まで表示
      return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
    };
    
    html += `
      <tr>
        <td>${exchangeId}</td>
        <td>${formatNumber(exchange.totalBuyCost)} 円</td>
        <td>${formatNumber(exchange.totalSellValue)} 円</td>
        <td>${formatNumber(exchange.totalFee)} 円</td>
        <td class="${pnlClass}">${formatNumber(exchange.realizedPnL)} 円</td>
        <td class="${netPnlClass}">${formatNumber(exchange.netPnL)} 円</td>
      </tr>
    `;
  });
  
  html += '</tbody></table></div>';
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
  
  // テーブルをレスポンシブコンテナで囲む
  let html = '<div class="table-responsive"><table class="summary-table table-sm">';
  html += `
    <thead>
      <tr>
        <th>戦略</th>
        <th>買った額</th>
        <th>売った額</th>
        <th>手数料</th>
        <th>実現損益</th>
        <th>純損益</th>
      </tr>
    </thead>
    <tbody>
  `;
  
  // 各戦略のデータを表示
  Object.keys(data.byStrategy).forEach(strategyKey => {
    const strategy = data.byStrategy[strategyKey];
    const pnlClass = strategy.realizedPnL > 0 ? 'profit' : strategy.realizedPnL < 0 ? 'loss' : '';
    const netPnlClass = strategy.netPnL > 0 ? 'profit' : strategy.netPnL < 0 ? 'loss' : '';
    
    // 数値を短く表示するためのフォーマット関数
    const formatNumber = (num) => {
      if (num === null || num === undefined) return '0';
      // 1000以上の場合は小数点以下を省略
      if (Math.abs(num) >= 1000) {
        return Math.round(num).toLocaleString();
      }
      // 1000未満の場合は小数点以下1桁まで表示
      return num.toLocaleString(undefined, { maximumFractionDigits: 1 });
    };
    
    html += `
      <tr>
        <td>${strategyKey}</td>
        <td>${formatNumber(strategy.totalBuyCost)} 円</td>
        <td>${formatNumber(strategy.totalSellValue)} 円</td>
        <td>${formatNumber(strategy.totalFee)} 円</td>
        <td class="${pnlClass}">${formatNumber(strategy.realizedPnL)} 円</td>
        <td class="${netPnlClass}">${formatNumber(strategy.netPnL)} 円</td>
      </tr>
    `;
  });
  
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

/**
 * 累積損益グラフを更新
 * @param {Object} data - APIから取得したサマリーデータ
 */
function updateProfitChart(data) {
  const canvas = document.getElementById('profitChart');
  const ctx = canvas.getContext('2d');
  
  // CSSで高さを制御するため、ここでの高さ設定は削除
  
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
          label: '純損益（手数料差引後）',
          data: [data.summary.netPnL],
          backgroundColor: data.summary.netPnL >= 0 ? 'rgba(40, 167, 69, 0.5)' : 'rgba(220, 53, 69, 0.5)',
          borderColor: data.summary.netPnL >= 0 ? 'rgb(40, 167, 69)' : 'rgb(220, 53, 69)',
          borderWidth: 1
        },
        {
          label: '実現損益（手数料込み）',
          data: [data.summary.realizedPnL],
          backgroundColor: data.summary.realizedPnL >= 0 ? 'rgba(92, 184, 92, 0.3)' : 'rgba(217, 83, 79, 0.3)',
          borderColor: data.summary.realizedPnL >= 0 ? 'rgb(92, 184, 92)' : 'rgb(217, 83, 79)',
          borderWidth: 1
        },
        {
          label: '手数料',
          data: [data.summary.totalFee],
          backgroundColor: 'rgba(240, 173, 78, 0.5)',
          borderColor: 'rgb(240, 173, 78)',
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
  
  // APIからデータ取得（約定履歴を使用）
  fetch('/api/filled-history?limit=50')
    .then(response => response.json())
    .then(data => {
      if (!data.history || data.history.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="10" class="text-center">約定データがありません</td>
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
      console.error('約定履歴の取得に失敗しました:', error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="10" class="text-center text-danger">
            約定履歴の取得に失敗しました。詳細はコンソールを確認してください。
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
      <td>${trade.fee !== null && trade.fee !== undefined ? trade.fee.toLocaleString() : '-'}</td>
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
  
  // 注文ペア更新イベント
  realtimeUpdater.addListener('order_pair_updated', (data) => {
    console.log('注文ペア更新イベント受信:', data);
    // 注文ペアサマリーを更新
    loadOrderPairsSummary();
  });
}

// 短時間の重複更新を避けるための遅延処理
let updateTimeout = null;
function debounceUpdate() {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    loadPositions();
    loadSummary();
    loadOrderPairsSummary(); // 注文ペアサマリーも更新
  }, 1000);
}

/**
 * 最近の取引テーブルに新しい取引を追加
 * @param {Object} trade - 追加する取引データ
 */
function addTradeToRecentTable(trade) {
  const tableBody = document.querySelector('#recent-trades-table tbody');
  
  // 「データなし」の行がある場合は削除
  const noDataRow = tableBody.querySelector('td[colspan="10"]');
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

/**
 * 注文ペアサマリーを読み込んで表示
 */
/**
 * 注文ペアサマリーを読み込んで表示
 */
function loadOrderPairsSummary() {
  const container = document.getElementById('order-pairs-summary-container');
  
  // ローディング表示
  container.innerHTML = `
    <div class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">読み込み中...</span>
      </div>
    </div>
  `;
  
  // APIからデータ取得
  fetch('/api/current-order-pairs')
    .then(response => response.json())
    .then(data => {
      if (!data.currentOrderPairs || data.currentOrderPairs.length === 0) {
        container.innerHTML = `
          <div class="no-data-message">
            <p>注文ペアデータがありません</p>
          </div>
        `;
        return;
      }
      
      // 全データを保存
      allOrderPairs = data.currentOrderPairs;
      
      // 銘柄リストを更新
      updateSymbolDropdown();
      
      // フィルタに基づいて表示
      displayFilteredOrderPairs();
    })
    .catch(error => {
      console.error('注文ペアサマリーの取得に失敗しました:', error);
      container.innerHTML = `
        <div class="alert alert-danger" role="alert">
          注文ペアサマリーの取得に失敗しました。詳細はコンソールを確認してください。
        </div>
      `;
    });
}

/**
 * 銘柄ドロップダウンを更新
 */
function updateSymbolDropdown() {
  const symbolFilter = document.getElementById('symbol-filter');
  if (!symbolFilter) return;
  
  // 現在の選択値を保存
  const currentValue = symbolFilter.value;
  
  // ユニークな銘柄リストを取得
  const uniqueSymbols = [...new Set(allOrderPairs.map(item => item.symbol))].sort();
  
  // ドロップダウンの選択肢を更新（「すべて表示」オプションは維持）
  let options = '<option value="all">すべて表示</option>';
  uniqueSymbols.forEach(symbol => {
    options += `<option value="${symbol}">${symbol}</option>`;
  });
  
  symbolFilter.innerHTML = options;
  
  // 以前の選択値が存在すれば復元
  if (uniqueSymbols.includes(currentSymbolFilter) || currentSymbolFilter === 'all') {
    symbolFilter.value = currentSymbolFilter;
  } else {
    // 以前の選択値が存在しない場合は「すべて表示」に
    currentSymbolFilter = 'all';
    symbolFilter.value = 'all';
  }
}

/**
 * フィルタに基づいて注文ペアを表示
 */
function displayFilteredOrderPairs() {
  const container = document.getElementById('order-pairs-summary-container');
  
  // フィルタリング
  let filteredPairs = allOrderPairs;
  if (currentSymbolFilter !== 'all') {
    filteredPairs = allOrderPairs.filter(item => item.symbol === currentSymbolFilter);
  }
  
  if (filteredPairs.length === 0) {
    container.innerHTML = `
      <div class="no-data-message">
        <p>条件に一致する注文ペアはありません</p>
      </div>
    `;
    return;
  }
  
  // カードを生成
  let html = '';
  
  filteredPairs.forEach(item => {
    // 買い/売り注文情報を取得
    const buyOrder = item.pair.buyOrder || {};
    const sellOrder = item.pair.sellOrder || {};
    
    // ステータスバッジのスタイルを決定
    const getBadgeClass = (status) => {
      switch(status) {
        case 'open': return 'bg-primary';
        case 'closed': return 'bg-success';
        case 'canceled': return 'bg-warning';
        case 'expired': return 'bg-secondary';
        case 'rejected': return 'bg-danger';
        default: return 'bg-secondary';
      }
    };
    
    // 価格とステータスの表示を整形
    const buyPrice = buyOrder.price ? buyOrder.price.toLocaleString() : '-';
    const sellPrice = sellOrder.price ? sellOrder.price.toLocaleString() : '-';
    const buyStatus = buyOrder.status || '-';
    const sellStatus = sellOrder.status || '-';
    const amount = item.pair.amount || (buyOrder.amount || sellOrder.amount || 0);
    
    // 買い/売り注文の状態に応じたバッジスタイル
    const buyBadgeClass = getBadgeClass(buyStatus);
    const sellBadgeClass = getBadgeClass(sellStatus);
    
    // 日時表示
    const formatDate = (timestamp) => {
      if (!timestamp) return '-';
      const date = new Date(timestamp);
      return date.toLocaleString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    };
    
    const buyDate = formatDate(buyOrder.timestamp);
    const sellDate = formatDate(sellOrder.timestamp);
    
    // カードHTMLを生成
    html += `
      <div class="order-pair-card">
        <h6>
          ${item.symbol}
          <small class="text-muted">${item.exchangeId}</small>
        </h6>
        <div class="small text-muted mb-2">${item.strategyKey}</div>
        
        <div class="price-info">
          <span class="price-label">買価格:</span>
          <span class="buy-price">${buyPrice}</span>
        </div>
        <div class="price-info">
          <span class="price-label">売価格:</span>
          <span class="sell-price">${sellPrice}</span>
        </div>
        
        <div class="small">数量: ${amount}</div>
        
        <div class="status">
          <span>買: <span class="badge ${buyBadgeClass}">${buyStatus}</span></span>
          <span>売: <span class="badge ${sellBadgeClass}">${sellStatus}</span></span>
        </div>
        
        <div class="metadata">
          <div>買: ${buyDate}</div>
          <div>売: ${sellDate}</div>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}