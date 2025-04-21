/**
 * ポジション詳細画面の機能を制御するスクリプト
 */

// グローバル変数
let currentFilters = {
  exchangeId: 'all',
  symbol: 'all',
  strategyKey: 'all'
};

// ページング関連の変数
let currentPage = 1;
let pageSize = 10;
let totalPositions = [];

// 初期化関数
function initPositions() {
  console.log('ポジション詳細の初期化を開始します');
  
  // ページサイズの初期設定
  pageSize = parseInt(document.getElementById('page-size-selector').value);
  
  // 初期データ読み込み
  loadPositions();
  
  // フィルターのイベントリスナー設定
  document.getElementById('exchange-filter').addEventListener('change', updateFilters);
  document.getElementById('symbol-filter').addEventListener('change', updateFilters);
  document.getElementById('strategy-filter').addEventListener('change', updateFilters);
  
  // ページサイズ変更のイベントリスナー
  document.getElementById('page-size-selector').addEventListener('change', function() {
    pageSize = parseInt(this.value);
    currentPage = 1; // ページサイズ変更時は1ページ目に戻る
    displayPositions(); // 表示を更新
  });
  
  // ページネーションのイベントリスナー
  document.getElementById('prev-page').addEventListener('click', function(e) {
    e.preventDefault();
    if (currentPage > 1) {
      currentPage--;
      displayPositions();
    }
  });
  
  document.getElementById('next-page').addEventListener('click', function(e) {
    e.preventDefault();
    const maxPage = Math.ceil(totalPositions.length / pageSize);
    if (currentPage < maxPage) {
      currentPage++;
      displayPositions();
    }
  });
  
  // リアルタイム更新の設定
  setupRealtimeUpdates();
}

/**
 * フィルターの更新
 */
function updateFilters() {
  currentFilters.exchangeId = document.getElementById('exchange-filter').value;
  currentFilters.symbol = document.getElementById('symbol-filter').value;
  currentFilters.strategyKey = document.getElementById('strategy-filter').value;
  
  // フィルター変更時は1ページ目に戻る
  currentPage = 1;
  
  // データを再読み込み
  loadPositions();
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
  
  // クエリパラメータの構築
  let queryParams = [];
  if (currentFilters.exchangeId !== 'all') {
    queryParams.push(`exchangeId=${encodeURIComponent(currentFilters.exchangeId)}`);
  }
  if (currentFilters.symbol !== 'all') {
    queryParams.push(`symbol=${encodeURIComponent(currentFilters.symbol)}`);
  }
  if (currentFilters.strategyKey !== 'all') {
    queryParams.push(`strategyKey=${encodeURIComponent(currentFilters.strategyKey)}`);
  }
  
  const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
  
  // APIからデータ取得
  fetch(`/api/positions${queryString}`)
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
      
      // フィルターオプションを更新
      updateFilterOptions(data.positions);
      
      // 全ポジションデータを保存
      totalPositions = data.positions;
      
      // ページングを使用してポジションを表示
      displayPositions();
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
 * フィルターオプションを更新
 * @param {Array} positions - ポジションデータ配列
 */
function updateFilterOptions(positions) {
  const exchanges = new Set();
  const symbols = new Set();
  const strategies = new Set();
  
  positions.forEach(position => {
    exchanges.add(position.exchangeId);
    symbols.add(position.symbol);
    strategies.add(position.strategyKey);
  });
  
  // 現在の選択値を保存
  const currentExchange = document.getElementById('exchange-filter').value;
  const currentSymbol = document.getElementById('symbol-filter').value;
  const currentStrategy = document.getElementById('strategy-filter').value;
  
  // 取引所フィルターを更新
  let exchangeOptions = '<option value="all">すべて</option>';
  exchanges.forEach(exchange => {
    exchangeOptions += `<option value="${exchange}" ${currentExchange === exchange ? 'selected' : ''}>${exchange}</option>`;
  });
  document.getElementById('exchange-filter').innerHTML = exchangeOptions;
  
  // 銘柄フィルターを更新
  let symbolOptions = '<option value="all">すべて</option>';
  symbols.forEach(symbol => {
    symbolOptions += `<option value="${symbol}" ${currentSymbol === symbol ? 'selected' : ''}>${symbol}</option>`;
  });
  document.getElementById('symbol-filter').innerHTML = symbolOptions;
  
  // 戦略フィルターを更新
  let strategyOptions = '<option value="all">すべて</option>';
  strategies.forEach(strategy => {
    strategyOptions += `<option value="${strategy}" ${currentStrategy === strategy ? 'selected' : ''}>${strategy}</option>`;
  });
  document.getElementById('strategy-filter').innerHTML = strategyOptions;
}

/**
 * リアルタイム更新の設定
 */
function setupRealtimeUpdates() {
  // 取引追加イベント
  realtimeUpdater.addListener('trade_added', (tradeData) => {
    // ポジションを更新（重複更新を避けるため遅延実行）
    debounceUpdate();
  });
  
  // バッチ更新イベント
  realtimeUpdater.addListener('batch_update', (updates) => {
    // ポジションを更新
    debounceUpdate();
  });
}

// 短時間の重複更新を避けるための遅延処理
let updateTimeout = null;
function debounceUpdate() {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(() => {
    loadPositions();
  }, 1000);
}

/**
 * ポジションデータを表示（ページング対応）
 */
function displayPositions() {
  const container = document.getElementById('positions-container');
  
  if (totalPositions.length === 0) {
    container.innerHTML = `
      <div class="no-data-message">
        <p>現在のポジションはありません</p>
      </div>
    `;
    updatePagination(0);
    return;
  }
  
  // 現在のページのデータを取得
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalPositions.length);
  const currentPageData = totalPositions.slice(startIndex, endIndex);
  
  // ポジションカードを表示
  let html = '';
  currentPageData.forEach(position => {
    const isPositive = position.realizedPnL > 0;
    const cardClass = isPositive ? 'positive' : position.realizedPnL < 0 ? 'negative' : '';
    
    html += `
      <div class="position-card ${cardClass} mb-3" id="position-card-${position.exchangeId}-${position.symbol.replace('/', '-')}-${position.strategyKey}">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="card-subtitle text-muted">${position.exchangeId} - ${position.symbol} - ${position.strategyKey}</h6>
            <span class="badge ${position.realizedPnL > 0 ? 'bg-success' : position.realizedPnL < 0 ? 'bg-danger' : 'bg-secondary'} me-1">
              ${position.realizedPnL !== null && position.realizedPnL !== undefined ? position.realizedPnL.toLocaleString() : '0'}
            </span>
            +
            <span class="badge bg-info text-dark me-1">
              ${position.totalFee !== null && position.totalFee !== undefined ? position.totalFee.toLocaleString() : '0'} 
            </span>
            =
            <span class="badge ${position.netPnL > 0 ? 'bg-success' : position.netPnL < 0 ? 'bg-danger' : 'bg-secondary'}">
              ${position.netPnL !== null && position.netPnL !== undefined ? position.netPnL.toLocaleString() : '0'} 円
            </span>
          </div>
          <div class="row">
            <div class="col-6">
              <p class="mb-1"><strong>買い量:</strong> ${position.buyAmount}</p>
              <p class="mb-1"><strong>平均購入価格:</strong> ${position.averageBuyPrice !== null && position.averageBuyPrice !== undefined ? position.averageBuyPrice.toLocaleString() : '0'} 円</p>
              <p class="mb-1"><strong>購入合計:</strong> ${position.totalBuyCost !== null && position.totalBuyCost !== undefined ? position.totalBuyCost.toLocaleString() : '0'} 円</p>
            </div>
            <div class="col-6">
              <p class="mb-1"><strong>売り量:</strong> ${position.sellAmount}</p>
              <p class="mb-1"><strong>平均販売価格:</strong> ${position.averageSellPrice !== null && position.averageSellPrice !== undefined ? position.averageSellPrice.toLocaleString() : '0'} 円</p>
              <p class="mb-1"><strong>売却合計:</strong> ${position.totalSellValue !== null && position.totalSellValue !== undefined ? position.totalSellValue.toLocaleString() : '0'} 円</p>
            </div>
          </div>
          <div class="mt-2">
            <p class="mb-0"><strong>現在のポジション:</strong> ${position.netPosition}</p>
          </div>
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // ページネーションを更新
  updatePagination(totalPositions.length);
}

/**
 * ページネーションUIを更新
 * @param {number} totalItems - 総アイテム数
 */
function updatePagination(totalItems) {
  const paginationContainer = document.getElementById('pagination-container');
  const paginationList = paginationContainer.querySelector('ul.pagination');
  
  // 総ページ数を計算
  const totalPages = Math.ceil(totalItems / pageSize);
  
  // ページネーションが必要ない場合は非表示
  if (totalPages <= 1) {
    paginationContainer.style.display = 'none';
    return;
  } else {
    paginationContainer.style.display = 'flex';
  }
  
  // 前へボタンの状態を更新
  const prevButton = document.getElementById('prev-page').parentNode;
  if (currentPage <= 1) {
    prevButton.classList.add('disabled');
  } else {
    prevButton.classList.remove('disabled');
  }
  
  // 次へボタンの状態を更新
  const nextButton = document.getElementById('next-page').parentNode;
  if (currentPage >= totalPages) {
    nextButton.classList.add('disabled');
  } else {
    nextButton.classList.remove('disabled');
  }
  
  // ページ番号ボタンを生成
  let pageButtonsHtml = '';
  
  // 表示するページ番号の範囲を決定
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  
  // 範囲が5ページに満たない場合、可能であれば範囲を調整
  if (endPage - startPage < 4) {
    startPage = Math.max(1, endPage - 4);
  }
  
  // 最初のページへのリンク
  if (startPage > 1) {
    pageButtonsHtml += `
      <li class="page-item">
        <a class="page-link" href="#" data-page="1">1</a>
      </li>
    `;
    if (startPage > 2) {
      pageButtonsHtml += `
        <li class="page-item disabled">
          <span class="page-link">...</span>
        </li>
      `;
    }
  }
  
  // ページ番号ボタン
  for (let i = startPage; i <= endPage; i++) {
    pageButtonsHtml += `
      <li class="page-item ${i === currentPage ? 'active' : ''}">
        <a class="page-link" href="#" data-page="${i}">${i}</a>
      </li>
    `;
  }
  
  // 最後のページへのリンク
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      pageButtonsHtml += `
        <li class="page-item disabled">
          <span class="page-link">...</span>
        </li>
      `;
    }
    pageButtonsHtml += `
      <li class="page-item">
        <a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a>
      </li>
    `;
  }
  
  // 前へ・次へボタンの間にページ番号ボタンを挿入
  paginationList.innerHTML = `
    <li class="page-item ${currentPage <= 1 ? 'disabled' : ''}">
      <a class="page-link" href="#" id="prev-page">前へ</a>
    </li>
    ${pageButtonsHtml}
    <li class="page-item ${currentPage >= totalPages ? 'disabled' : ''}">
      <a class="page-link" href="#" id="next-page">次へ</a>
    </li>
  `;
  
  // ページ番号ボタンのイベントリスナーを設定
  paginationList.querySelectorAll('a.page-link[data-page]').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      currentPage = parseInt(this.getAttribute('data-page'));
      displayPositions();
    });
  });
  
  // 前へ・次へボタンのイベントリスナーを再設定
  document.getElementById('prev-page').addEventListener('click', function(e) {
    e.preventDefault();
    if (currentPage > 1) {
      currentPage--;
      displayPositions();
    }
  });
  
  document.getElementById('next-page').addEventListener('click', function(e) {
    e.preventDefault();
    if (currentPage < totalPages) {
      currentPage++;
      displayPositions();
    }
  });
}

// スクリプトが読み込まれたら即時実行
// DOMContentLoadedが既に発火していても動作するように
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPositions);
} else {
  // DOMはすでに読み込み済み
  initPositions();
}