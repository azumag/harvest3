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
  
  // HTMLエスケープ処理
  const escapeHtml = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
  
  // 各データを処理
  const pairId = escapeHtml(String(pair.id));
  const buyOrderIdEscaped = escapeHtml(buyOrderId);
  const sellOrderIdEscaped = escapeHtml(sellOrderId);
  const buyOrderDateEscaped = escapeHtml(buyOrderDate);
  const sellOrderDateEscaped = escapeHtml(sellOrderDate);
  
  // ソート用のタイムスタンプ（存在する場合）
  const buyOrderTimestamp = buyOrder.datetime ? new Date(buyOrder.datetime).getTime() : 0;
  const sellOrderTimestamp = sellOrder.datetime ? new Date(sellOrder.datetime).getTime() : 0;
  
  return `
    <tr>
      <td>${escapeHtml(exchangeId)}</td>
      <td>${escapeHtml(symbol)}</td>
      <td>${escapeHtml(strategyKey)}</td>
      <td>${escapeHtml(String(pair.amount))}</td>
      <td>${escapeHtml(buyOrderPrice)}</td>
      <td>${buyOrderStatus}</td>
      <td>${escapeHtml(sellOrderPrice)}</td>
      <td>${sellOrderStatus}</td>
      <td data-order="${pairId}" data-search="${pairId}">${pairId}</td>
      <td data-order="${buyOrderTimestamp}" data-search="${buyOrderDateEscaped}">${buyOrderDateEscaped}</td>
      <td data-order="${sellOrderTimestamp}" data-search="${sellOrderDateEscaped}">${sellOrderDateEscaped}</td>
      <td data-order="${buyOrderIdEscaped}" data-search="${buyOrderIdEscaped}">${buyOrderIdEscaped}</td>
      <td data-order="${sellOrderIdEscaped}" data-search="${sellOrderIdEscaped}">${sellOrderIdEscaped}</td>
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
      { searchable: true, targets: '_all' },               // すべての列を検索可能に設定
      {
        width: '30px',
        className: 'narrow-id',
        render: function(data, type, row) {
          // データをエスケープ
          const escaped = data ? String(data)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;') : '';
          
          // 表示用と検索用で異なる値を返す
          if (type === 'display' && escaped) {
            return `<span title="${escaped}" class="narrow-id">${escaped}</span>`;
          }
          // 検索用と並べ替え用はプレーンテキストを返す
          return escaped;
        },
        targets: [8]                                       // ID列
      },
      {
        width: '60px',
        className: 'narrow-date',
        render: function(data, type, row) {
          // データをエスケープ
          const escaped = data ? String(data)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;') : '';
          
          // 表示用処理（日時の短縮表示）
          if (type === 'display' && escaped) {
            let shortDate = escaped;
            if (escaped !== '-' && escaped.length > 10) {
              shortDate = escaped.split(' ')[0]; // 日付部分のみ表示
            }
            return `<span title="${escaped}" class="narrow-date">${shortDate}</span>`;
          }
          // 検索用と並べ替え用はプレーンテキストを返す
          return escaped;
        },
        targets: [9, 10]                                   // 日時列
      },
      {
        render: function(data, type, row) {
          // データをエスケープ
          const escaped = data ? String(data)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;') : '';
          
          // 表示用と検索用で異なる値を返す
          if (type === 'display' && escaped) {
            return `<span title="${escaped}">${escaped}</span>`;
          }
          // 検索用と並べ替え用はプレーンテキストを返す
          return escaped;
        },
        targets: [11, 12]                                  // 買い注文ID、売り注文ID列
      }
    ],
    // 検索機能の設定
    search: {
      smart: true,
      regex: false,
      caseInsensitive: true
    },
    // 検索処理のカスタマイズ
    initComplete: function() {
      const api = this.api();
      
      // カスタム検索処理を追加
      $('.dataTables_filter input')
        .off() // デフォルトのイベントハンドラを削除
        .on('input', function() {
          const searchValue = $(this).val();
          api.search(searchValue).draw();
        });
    }
  });
}