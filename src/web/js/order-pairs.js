/**
 * 注文ペア画面の機能を制御するスクリプト
 */

// ページロード完了時の処理
document.addEventListener('DOMContentLoaded', () => {
  // フィルターフォームの設定
  setupFilterForm();
  
  // 初期データ読み込み
  loadFilterOptions();
  
  // 初期状態で最新の注文ペアを表示
  loadLatestOrderPairs();
  
  // リアルタイム更新の設定
  setupRealtimeUpdates();
});

/**
 * フィルターフォームの設定
 */
function setupFilterForm() {
  const form = document.getElementById('order-pairs-filter-form');
  
  // フォーム送信イベント
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    loadOrderPairs();
  });
  
  // リセットボタンイベント
  form.addEventListener('reset', (e) => {
    // フォームリセット後に少し遅延させてから表示をクリア
    setTimeout(() => {
      clearOrderPairsTable();
    }, 100);
  });
}

/**
 * フィルターオプションを読み込む（取引所、通貨ペア、戦略）
 */
function loadFilterOptions() {
  // 取引所、通貨ペア、戦略の一覧を取得するために最新のポジション情報を利用
  fetch('/api/positions')
    .then(response => response.json())
    .then(data => {
      if (!data.positions) return;
      
      // 一意の値を保持するセット
      const exchanges = new Set();
      const symbols = new Set();
      const strategies = new Set();
      
      // 値を抽出
      data.positions.forEach(pos => {
        exchanges.add(pos.exchangeId);
        symbols.add(pos.symbol);
        strategies.add(pos.strategyKey);
      });
      
      // セレクトボックスに追加
      populateSelectOptions('exchange-filter', Array.from(exchanges));
      populateSelectOptions('symbol-filter', Array.from(symbols));
      populateSelectOptions('strategy-filter', Array.from(strategies));
    })
    .catch(error => {
      console.error('フィルターオプションの取得に失敗しました:', error);
    });
}

/**
 * セレクトボックスにオプションを追加
 * @param {string} elementId - セレクト要素のID
 * @param {Array} options - 追加するオプション配列
 */
function populateSelectOptions(elementId, options) {
  const select = document.getElementById(elementId);
  if (!select) return;
  
  // 既存のオプションをクリア（最初の「選択してください」オプションは残す）
  const defaultOption = select.querySelector('option[value=""]');
  select.innerHTML = '';
  select.appendChild(defaultOption);
  
  // 新しいオプションを追加
  options.forEach(option => {
    const optElement = document.createElement('option');
    optElement.value = option;
    optElement.textContent = option;
    select.appendChild(optElement);
  });
}

/**
 * 最新の注文ペアを読み込んで表示（初期表示用）
 */
function loadLatestOrderPairs() {
  const tableBody = document.querySelector('#order-pairs-table tbody');
  
  // ローディング表示
  tableBody.innerHTML = `
    <tr>
      <td colspan="13" class="text-center py-4">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">読み込み中...</span>
        </div>
      </td>
    </tr>
  `;
  
  // クエリパラメータ構築（制限のみ）
  const params = new URLSearchParams();
  params.append('limit', 100);
  
  // APIからデータ取得
  fetch(`/api/order-pairs?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      if (!data.orderPairs || data.orderPairs.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="13" class="text-center">注文ペアデータがありません</td>
          </tr>
        `;
        return;
      }
      
      // テーブルを更新
      let html = '';
      data.orderPairs.forEach(pair => {
        html += createOrderPairTableRow(pair);
      });
      
      tableBody.innerHTML = html;
      
      // DataTablesを初期化
      initializeDataTable();
    })
    .catch(error => {
      console.error('注文ペアの取得に失敗しました:', error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="13" class="text-center text-danger">
            注文ペアの取得に失敗しました。詳細はコンソールを確認してください。
          </td>
        </tr>
      `;
    });
}

/**
 * 注文ペアを読み込んで表示（フィルター適用時）
 */
function loadOrderPairs() {
  const tableBody = document.querySelector('#order-pairs-table tbody');
  
  // フォームからフィルター値を取得
  const exchangeId = document.getElementById('exchange-filter').value;
  const symbol = document.getElementById('symbol-filter').value;
  const strategyKey = document.getElementById('strategy-filter').value;
  
  // ローディング表示
  tableBody.innerHTML = `
    <tr>
      <td colspan="13" class="text-center py-4">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">読み込み中...</span>
        </div>
      </td>
    </tr>
  `;
  
  // クエリパラメータ構築
  const params = new URLSearchParams();
  if (exchangeId) params.append('exchangeId', exchangeId);
  if (symbol) params.append('symbol', symbol);
  if (strategyKey) params.append('strategyKey', strategyKey);
  params.append('limit', 100);
  
  // APIからデータ取得
  fetch(`/api/order-pairs?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      if (!data.orderPairs || data.orderPairs.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="13" class="text-center">注文ペアデータがありません</td>
          </tr>
        `;
        return;
      }
      
      // テーブルを更新
      let html = '';
      data.orderPairs.forEach(pair => {
        html += createOrderPairTableRow(pair);
      });
      
      tableBody.innerHTML = html;
      
      // DataTablesを初期化
      initializeDataTable();
    })
    .catch(error => {
      console.error('注文ペアの取得に失敗しました:', error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="13" class="text-center text-danger">
            注文ペアの取得に失敗しました。詳細はコンソールを確認してください。
          </td>
        </tr>
      `;
    });
}

/**
 * 注文ペアデータからテーブル行のHTMLを生成
 * @param {Object} pair - 注文ペアデータ
 * @returns {string} - HTML文字列
 */
function createOrderPairTableRow(pair) {
  // 取引所、シンボル、戦略情報
  const exchangeId = pair.exchangeId || '-';
  const symbol = pair.symbol || '-';
  const strategyKey = pair.strategyKey || '-';
  
  // 買い注文情報
  const buyOrder = pair.buyOrder || {};
  const buyOrderId = buyOrder.id || '-';
  const buyOrderDate = buyOrder.datetime ? new Date(buyOrder.datetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '-';
  const buyOrderPrice = buyOrder.price ? buyOrder.price.toLocaleString() : '-';
  const buyOrderStatus = getBuyOrderStatusText(buyOrder.status, pair.buyFilled);
  
  // 売り注文情報
  const sellOrder = pair.sellOrder || {};
  const sellOrderId = sellOrder.id || '-';
  const sellOrderDate = sellOrder.datetime ? new Date(sellOrder.datetime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '-';
  const sellOrderPrice = sellOrder.price ? sellOrder.price.toLocaleString() : '-';
  const sellOrderStatus = getSellOrderStatusText(sellOrder.status, pair.sellFilled);
  return `
    <tr>
      <td>${exchangeId}</td>
      <td>${symbol}</td>
      <td>${strategyKey}</td>
      <td>${pair.amount}</td>
      <td>${buyOrderPrice}</td>
      <td>${buyOrderStatus}</td>
      <td>${sellOrderPrice}</td>
      <td>${sellOrderStatus}</td>
      <td>${pair.id}</td>
      <td>${buyOrderDate}</td>
      <td>${sellOrderDate}</td>
      <td>${buyOrderId}</td>
      <td>${sellOrderId}</td>
    </tr>
  `;
}

/**
 * 買い注文の状態テキストを取得
 * @param {string} status - 注文ステータス
 * @param {boolean} isFilled - 約定済みフラグ
 * @returns {string} - 状態テキスト
 */
function getBuyOrderStatusText(status, isFilled) {
  if (isFilled) return '<span class="badge bg-success">約定済み</span>';
  
  switch (status) {
    case 'open':
      return '<span class="badge bg-primary">注文中</span>';
    case 'closed':
      return '<span class="badge bg-success">完了</span>';
    case 'canceled':
      return '<span class="badge bg-warning">キャンセル</span>';
    case 'expired':
      return '<span class="badge bg-secondary">期限切れ</span>';
    case 'rejected':
      return '<span class="badge bg-danger">拒否</span>';
    default:
      return status || '-';
  }
}

/**
 * 売り注文の状態テキストを取得
 * @param {string} status - 注文ステータス
 * @param {boolean} isFilled - 約定済みフラグ
 * @returns {string} - 状態テキスト
 */
function getSellOrderStatusText(status, isFilled) {
  if (isFilled) return '<span class="badge bg-success">約定済み</span>';
  if (!status) return '<span class="badge bg-secondary">未発注</span>';
  
  switch (status) {
    case 'open':
      return '<span class="badge bg-primary">注文中</span>';
    case 'closed':
      return '<span class="badge bg-success">完了</span>';
    case 'canceled':
      return '<span class="badge bg-warning">キャンセル</span>';
    case 'expired':
      return '<span class="badge bg-secondary">期限切れ</span>';
    case 'rejected':
      return '<span class="badge bg-danger">拒否</span>';
    default:
      return status;
  }
}

/**
 * 注文ペアテーブルをクリアして初期データを再読み込み
 */
function clearOrderPairsTable() {
  // 最新の注文ペアを再読み込み
  loadLatestOrderPairs();
}

/**
 * リアルタイム更新の設定
 */
function setupRealtimeUpdates() {
  // 注文ペア更新イベント
  realtimeUpdater.addListener('order_pair_updated', (data) => {
    // 現在表示中の取引所、銘柄、戦略と一致する場合のみ更新
    const currentExchangeId = document.getElementById('exchange-filter').value;
    const currentSymbol = document.getElementById('symbol-filter').value;
    const currentStrategyKey = document.getElementById('strategy-filter').value;
    
    if (
      currentExchangeId && 
      currentSymbol && 
      currentStrategyKey && 
      data.exchangeId === currentExchangeId && 
      data.symbol === currentSymbol && 
      data.strategyKey === currentStrategyKey
    ) {
      // 表示を更新
      loadOrderPairs();
    }
  });
}

/**
 * DataTablesを初期化する関数
 */
function initializeDataTable() {
  // 既存のDataTableを破棄
  const existingTable = $('#order-pairs-table').DataTable();
  if ($.fn.DataTable.isDataTable('#order-pairs-table')) {
    existingTable.destroy();
  }
  
  // 最初にスタイルを追加
  const style = document.createElement('style');
  style.textContent = `
    .narrow-id { max-width: 30px; width: 30px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .narrow-date { max-width: 60px; width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  document.head.appendChild(style);

  // 新しいDataTableを初期化
  $('#order-pairs-table').DataTable({
    responsive: true,
    autoWidth: false,
    pageLength: 25,
    lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, "全て"]],
    language: {
      url: "https://cdn.datatables.net/plug-ins/1.13.1/i18n/ja.json"
    },
    dom: 'Bfrtip',
    buttons: [
      'copy', 'csv', 'excel'
    ],
    columnDefs: [
      { responsivePriority: 1, targets: [0, 1, 2, 3] },    // 優先して表示する列（取引所、シンボル、戦略、数量）
      { responsivePriority: 2, targets: [5, 7] },          // 次に優先する列（注文ステータス）
      { responsivePriority: 3, targets: '_all' },          // その他の列
      {
        width: '30px',
        className: 'narrow-id',
        render: function(data, type, row) {
          if (type === 'display') {
            return `<span title="${data}" class="narrow-id">${data}</span>`;
          }
          return data;
        },
        targets: [8]                                       // ID列
      },
      {
        width: '60px',
        className: 'narrow-date',
        render: function(data, type, row) {
          if (type === 'display') {
            // 日時を短く表示（ホバーで完全表示）
            const fullDate = data;
            let shortDate = data;
            if (data !== '-' && data.length > 10) {
              shortDate = data.split(' ')[0]; // 日付部分のみ表示
            }
            return `<span title="${fullDate}" class="narrow-date">${shortDate}</span>`;
          }
          return data;
        },
        targets: [9, 10]                                   // 日時列
      }
    ]
  });
}