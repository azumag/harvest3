/**
 * シグナル履歴画面の機能を制御するスクリプト
 */

// グローバル変数
let allSignals = []; // すべてのシグナルデータを保持
let currentPage = 1;
let signalsPerPage = 20;
let totalPages = 1;
let filters = {}; // フィルター条件を保持

// 初期化関数
function initSignalHistory() {
  console.log('シグナル履歴ページの初期化を開始します');
  
  // フィルターフォームのイベントリスナーを設定
  setupFilterForm();
  
  // 初期データの読み込み
  loadSignalHistoryData();
  
  // 取引所・銘柄・戦略のフィルターオプションを読み込み
  loadFilterOptions();
  
  // リアルタイム更新の設定
  setupRealtimeUpdates();
}

// スクリプトが読み込まれたら即時実行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSignalHistory);
} else {
  // DOMはすでに読み込み済み
  initSignalHistory();
}

/**
 * フィルターフォームのセットアップ
 */
function setupFilterForm() {
  const form = document.getElementById('signal-filter-form');
  const resetButton = document.getElementById('reset-filter');
  
  // フォーム送信イベント
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    
    // フィルター条件を取得
    filters = {
      exchange: document.getElementById('exchange-filter').value,
      symbol: document.getElementById('symbol-filter').value,
      strategy: document.getElementById('strategy-filter').value,
      signal_type: document.getElementById('signal-type-filter').value,
      start_time: document.getElementById('start-date').value ? new Date(document.getElementById('start-date').value).getTime() : '',
      end_time: document.getElementById('end-date').value ? new Date(document.getElementById('end-date').value).getTime() : ''
    };
    
    // ページをリセットして再読み込み
    currentPage = 1;
    loadSignalHistoryData();
  });
  
  // リセットボタンのイベント
  resetButton.addEventListener('click', function() {
    form.reset();
    filters = {};
    currentPage = 1;
    loadSignalHistoryData();
  });
}

/**
 * フィルターオプションを読み込む
 */
function loadFilterOptions() {
  // 取引所一覧を取得
  fetch('/api/exchanges')
    .then(response => response.json())
    .then(data => {
      const select = document.getElementById('exchange-filter');
      data.forEach(exchange => {
        const option = document.createElement('option');
        option.value = exchange;
        option.textContent = exchange;
        select.appendChild(option);
      });
    })
    .catch(error => console.error('取引所一覧の取得に失敗しました:', error));
  
  // 銘柄一覧を取得
  fetch('/api/symbols')
    .then(response => response.json())
    .then(data => {
      const select = document.getElementById('symbol-filter');
      data.forEach(symbol => {
        const option = document.createElement('option');
        option.value = symbol;
        option.textContent = symbol;
        select.appendChild(option);
      });
    })
    .catch(error => console.error('銘柄一覧の取得に失敗しました:', error));
  
  // 戦略一覧を取得
  fetch('/api/strategies')
    .then(response => response.json())
    .then(data => {
      const select = document.getElementById('strategy-filter');
      data.forEach(strategy => {
        const option = document.createElement('option');
        option.value = strategy;
        option.textContent = strategy;
        select.appendChild(option);
      });
    })
    .catch(error => console.error('戦略一覧の取得に失敗しました:', error));
}

/**
 * シグナル履歴データを読み込む
 */
function loadSignalHistoryData() {
  // テーブルボディを取得
  const tbody = document.getElementById('signals-tbody');
  
  // ローディング表示
  tbody.innerHTML = `
    <tr>
      <td colspan="7" class="text-center">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">読み込み中...</span>
        </div>
      </td>
    </tr>
  `;
  
  // APIパラメータを構築
  const params = new URLSearchParams({
    limit: signalsPerPage,
    offset: (currentPage - 1) * signalsPerPage
  });
  
  // フィルター条件を追加
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.append(key, value);
  });
  
  // APIからデータ取得
  fetch(`/api/strategy-signals?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      allSignals = data.data;
      displaySignalHistory(data);
      updatePagination(data.count);
    })
    .catch(error => {
      console.error('シグナル履歴の取得に失敗しました:', error);
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center">
            <div class="alert alert-danger" role="alert">
              シグナル履歴の取得に失敗しました。詳細はコンソールを確認してください。
            </div>
          </td>
        </tr>
      `;
    });
}

/**
 * シグナル履歴を表示
 */
function displaySignalHistory(data) {
  const tbody = document.getElementById('signals-tbody');
  
  // データがない場合
  if (!data.data || data.data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center">表示するデータがありません</td>
      </tr>
    `;
    
    document.getElementById('showing-records').textContent = '0件中0件を表示';
    return;
  }
  
  // データ表示
  let html = '';
  
  data.data.forEach(signal => {
    // シグナルタイプに応じたクラスとテキスト
    const signalClass = signal.signalType === 'buy' ? 'bg-success' :
                      signal.signalType === 'sell' ? 'bg-danger' : 'bg-secondary';
    const signalText = signal.signalType === 'buy' ? '買い' :
                      signal.signalType === 'sell' ? '売り' : 'シグナルなし';
    
    // 日時フォーマット
    const date = new Date(signal.timestamp);
    const formattedDate = date.toLocaleString('ja-JP');
    
    html += `
      <tr data-signal-index="${data.data.indexOf(signal)}">
        <td>${formattedDate}</td>
        <td>${signal.exchangeId}</td>
        <td>${signal.symbol}</td>
        <td>${signal.strategyKey}</td>
        <td><span class="badge ${signalClass}">${signalText}</span></td>
        <td>${signal.price.toLocaleString()} 円</td>
        <td>
          <button class="btn btn-sm btn-outline-primary signal-detail-btn"
                  data-bs-toggle="modal" data-bs-target="#signal-detail-modal">
            詳細
          </button>
        </td>
      </tr>
    `;
  });
  
  tbody.innerHTML = html;
  
  // 表示件数更新
  const start = (currentPage - 1) * signalsPerPage + 1;
  const end = Math.min(start + data.data.length - 1, data.count);
  document.getElementById('showing-records').textContent = `${data.count}件中${start}〜${end}件を表示`;
  
  // 詳細ボタンのイベントリスナーを設定
  document.querySelectorAll('.signal-detail-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const row = this.closest('tr');
      const index = parseInt(row.getAttribute('data-signal-index'));
      showSignalDetail(data.data[index]);
    });
  });
}

/**
 * シグナル詳細モーダルを表示
 */
function showSignalDetail(signal) {
  const modalContent = document.getElementById('signal-detail-content');
  
  // シグナルタイプに応じたクラスとテキスト
  const signalClass = signal.signalType === 'buy' ? 'bg-success' :
                     signal.signalType === 'sell' ? 'bg-danger' : 'bg-secondary';
  const signalText = signal.signalType === 'buy' ? '買い' :
                     signal.signalType === 'sell' ? '売り' : 'シグナルなし';
  
  // 日時フォーマット
  const date = new Date(signal.timestamp);
  const formattedDate = date.toLocaleString('ja-JP');
  
  let html = `
    <div class="signal-detail">
      <h6>基本情報</h6>
      <table class="table table-sm">
        <tr>
          <th>日時</th>
          <td>${formattedDate}</td>
        </tr>
        <tr>
          <th>取引所</th>
          <td>${signal.exchangeId}</td>
        </tr>
        <tr>
          <th>銘柄</th>
          <td>${signal.symbol}</td>
        </tr>
        <tr>
          <th>戦略</th>
          <td>${signal.strategyKey}</td>
        </tr>
        <tr>
          <th>シグナル</th>
          <td><span class="badge ${signalClass}">${signalText}</span></td>
        </tr>
        <tr>
          <th>価格</th>
          <td>${signal.price.toLocaleString()} 円</td>
        </tr>
      </table>
  `;
  
  // 戦略固有の計算結果があれば表示
  if (signal.strategyResults && Object.keys(signal.strategyResults).length > 0) {
    html += `
      <h6>計算結果</h6>
      <table class="table table-sm">
    `;
    
    Object.entries(signal.strategyResults).forEach(([key, value]) => {
      html += `
        <tr>
          <th>${key}</th>
          <td>${typeof value === 'number' ? value.toLocaleString() : value}</td>
        </tr>
      `;
    });
    
    html += '</table>';
  }
  
  html += '</div>';
  modalContent.innerHTML = html;
}

/**
 * ページネーションを更新
 */
function updatePagination(totalCount) {
  const paginationContainer = document.querySelector('#signals-pagination .pagination');
  
  // 総ページ数を計算
  totalPages = Math.ceil(totalCount / signalsPerPage);
  
  if (totalPages <= 1) {
    // ページが1つしかない場合はページネーション非表示
    paginationContainer.innerHTML = '';
    return;
  }
  
  let paginationHtml = '';
  
  // 前へボタン
  paginationHtml += `
    <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
      <a class="page-link" href="#" data-page="${currentPage - 1}" aria-label="前へ">
        <span aria-hidden="true">&laquo;</span>
      </a>
    </li>
  `;
  
  // ページ番号
  // 表示するページ番号範囲を決定
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  startPage = Math.max(1, endPage - 4);
  
  if (startPage > 1) {
    paginationHtml += `
      <li class="page-item">
        <a class="page-link" href="#" data-page="1">1</a>
      </li>
    `;
    
    if (startPage > 2) {
      paginationHtml += `
        <li class="page-item disabled">
          <a class="page-link" href="#">...</a>
        </li>
      `;
    }
  }
  
  for (let i = startPage; i <= endPage; i++) {
    paginationHtml += `
      <li class="page-item ${i === currentPage ? 'active' : ''}">
        <a class="page-link" href="#" data-page="${i}">${i}</a>
      </li>
    `;
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      paginationHtml += `
        <li class="page-item disabled">
          <a class="page-link" href="#">...</a>
        </li>
      `;
    }
    
    paginationHtml += `
      <li class="page-item">
        <a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a>
      </li>
    `;
  }
  
  // 次へボタン
  paginationHtml += `
    <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
      <a class="page-link" href="#" data-page="${currentPage + 1}" aria-label="次へ">
        <span aria-hidden="true">&raquo;</span>
      </a>
    </li>
  `;
  
  paginationContainer.innerHTML = paginationHtml;
  
  // ページネーションのクリックイベントを設定
  document.querySelectorAll('#signals-pagination .page-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = parseInt(e.target.getAttribute('data-page') || e.target.parentElement.getAttribute('data-page'));
      if (!isNaN(page) && page > 0 && page <= totalPages) {
        currentPage = page;
        loadSignalHistoryData();
      }
    });
  });
}

/**
 * リアルタイム更新のセットアップ
 */
function setupRealtimeUpdates() {
  if (typeof setupEventSource === 'function') {
    // リアルタイム更新のイベントを購読
    setupEventSource('trade_events', (event) => {
      const data = JSON.parse(event.data);
      
      // 戦略シグナルイベントを処理
      if (data.type === 'strategy_signal_added') {
        processNewSignal(data.data);
      }
    });
  }
}

/**
 * 新しいシグナルを処理
 */
function processNewSignal(signal) {
  // フィルター条件に合致するか確認
  if (
    (filters.exchange && filters.exchange !== signal.exchangeId) ||
    (filters.symbol && filters.symbol !== signal.symbol) ||
    (filters.strategy && filters.strategy !== signal.strategyKey) ||
    (filters.signal_type && filters.signal_type !== signal.signalType) ||
    (filters.start_time && signal.timestamp < filters.start_time) ||
    (filters.end_time && signal.timestamp > filters.end_time)
  ) {
    return; // フィルター条件に一致しない場合は何もしない
  }
  
  // 現在のページが1ページ目の場合のみ表示を更新
  if (currentPage === 1) {
    // 最新シグナルを追加して再表示
    allSignals.unshift(signal);
    allSignals = allSignals.slice(0, signalsPerPage);
    
    displaySignalHistory({
      data: allSignals,
      count: parseInt(document.getElementById('showing-records').textContent.split('件中')[0]) + 1
    });
  } else {
    // 1ページ目以外の場合は、新しいシグナルがあることを通知
    const notification = document.createElement('div');
    notification.className = 'alert alert-info alert-dismissible fade show mt-2';
    notification.innerHTML = `
      新しいシグナルが追加されました。
      <a href="#" class="alert-link" id="reload-first-page">1ページ目に戻る</a>
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="閉じる"></button>
    `;
    
    const container = document.querySelector('.card-body');
    container.insertBefore(notification, container.firstChild);
    
    // 1ページ目に戻るリンクのイベント
    document.getElementById('reload-first-page').addEventListener('click', (e) => {
      e.preventDefault();
      currentPage = 1;
      loadSignalHistoryData();
    });
  }
}