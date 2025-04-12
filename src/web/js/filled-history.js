/**
 * 約定履歴画面の機能を制御するスクリプト
 */

// グローバル変数
let currentPage = 1;
let pageSize = 100;
let totalItems = 0;
let currentFilters = {};

// ページロード完了時の処理
document.addEventListener('DOMContentLoaded', () => {
  // フィルターフォームの設定
  setupFilterForm();
  
  // 初期データ読み込み
  loadFilterOptions();
  loadFilledTradeHistory();
  
  // リアルタイム更新の設定
  setupRealtimeUpdates();
});

/**
 * フィルターフォームの設定
 */
function setupFilterForm() {
  const form = document.getElementById('history-filter-form');
  
  // フォーム送信イベント
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    currentPage = 1; // フィルター変更時は1ページ目に戻る
    applyFilters();
  });
  
  // リセットボタンイベント
  form.addEventListener('reset', (e) => {
    // フォームリセット後に少し遅延させてから読み込み直す
    setTimeout(() => {
      currentPage = 1;
      currentFilters = {};
      loadFilledTradeHistory();
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
  
  // 既存のオプションをクリア（最初の「全て」オプションは残す）
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
 * フィルターを適用して履歴を再読み込み
 */
function applyFilters() {
  // フォームからフィルター値を取得
  const exchangeId = document.getElementById('exchange-filter').value;
  const symbol = document.getElementById('symbol-filter').value;
  const strategyKey = document.getElementById('strategy-filter').value;
  const side = document.getElementById('side-filter').value;
  const startDate = document.getElementById('start-date-filter').value;
  const endDate = document.getElementById('end-date-filter').value;
  
  // フィルターオブジェクトを更新
  currentFilters = {};
  
  if (exchangeId) currentFilters.exchangeId = exchangeId;
  if (symbol) currentFilters.symbol = symbol;
  if (strategyKey) currentFilters.strategyKey = strategyKey;
  if (side) currentFilters.side = side;
  
  // 日時はミリ秒タイムスタンプに変換
  if (startDate) {
    currentFilters.startDate = new Date(startDate).getTime();
  }
  if (endDate) {
    // 終了日は日の終わりの時刻に設定
    const endDateTime = new Date(endDate);
    endDateTime.setHours(23, 59, 59, 999);
    currentFilters.endDate = endDateTime.getTime();
  }
  
  // 履歴を再読み込み
  loadFilledTradeHistory();
}

/**
 * 約定履歴を読み込んで表示
 */
function loadFilledTradeHistory() {
  const tableBody = document.querySelector('#filled-trades-history-table tbody');
  
  // ローディング表示
  tableBody.innerHTML = `
    <tr>
      <td colspan="11" class="text-center py-4">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">読み込み中...</span>
        </div>
      </td>
    </tr>
  `;
  
  // クエリパラメータ構築
  const params = new URLSearchParams();
  params.append('limit', pageSize);
  params.append('offset', (currentPage - 1) * pageSize);
  
  // フィルターを追加
  Object.keys(currentFilters).forEach(key => {
    params.append(key, currentFilters[key]);
  });
  
  // APIからデータ取得
  fetch(`/api/filled-history?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      if (!data.history || data.history.length === 0) {
        tableBody.innerHTML = `
          <tr>
            <td colspan="11" class="text-center">約定データがありません</td>
          </tr>
        `;
        // ページネーション情報を更新
        updatePaginationInfo(0);
        return;
      }
      
      // テーブルを更新
      let html = '';
      data.history.forEach(trade => {
        html += createTradeTableRow(trade);
      });
      
      tableBody.innerHTML = html;
      
      // 合計数とページネーションを更新
      totalItems = data.total;
      updatePaginationInfo(data.total);
      updatePaginationControls(data.total);
    })
    .catch(error => {
      console.error('約定履歴の取得に失敗しました:', error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="11" class="text-center text-danger">
            約定履歴の取得に失敗しました。詳細はコンソールを確認してください。
          </td>
        </tr>
      `;
      updatePaginationInfo(0);
    });
}

/**
 * 約定データからテーブル行のHTMLを生成
 * @param {Object} trade - 約定データ
 * @returns {string} - HTML文字列
 */
function createTradeTableRow(trade) {
  const date = new Date(trade.timestamp);
  const formattedDate = date.toLocaleString('ja-JP');
  const sideClass = trade.side === 'buy' ? 'buy-trade' : 'sell-trade';
  
  return `
    <tr>
      <td>${trade.id}</td>
      <td>${formattedDate}</td>
      <td>${trade.exchangeId}</td>
      <td>${trade.symbol}</td>
      <td>${trade.strategyKey}</td>
      <td class="${sideClass}">${trade.side === 'buy' ? '買い' : '売り'}</td>
      <td>${trade.amount}</td>
      <td>${trade.price.toLocaleString()}</td>
      <td>${trade.value.toLocaleString()}</td>
      <td>${trade.fee !== undefined && trade.fee !== null ? trade.fee.toLocaleString() : '-'}</td>
    </tr>
  `;
}

/**
 * ページネーション情報を更新
 * @param {number} total - 合計アイテム数
 */
function updatePaginationInfo(total) {
  const infoElement = document.getElementById('total-count');
  if (infoElement) {
    infoElement.textContent = total;
  }
}

/**
 * ページネーションコントロールを更新
 * @param {number} total - 合計アイテム数
 */
function updatePaginationControls(total) {
  const paginationElement = document.getElementById('pagination-controls');
  if (!paginationElement) return;
  
  // 合計ページ数を計算
  const totalPages = Math.ceil(total / pageSize);
  
  // ページが1ページのみの場合はコントロールを表示しない
  if (totalPages <= 1) {
    paginationElement.innerHTML = '';
    return;
  }
  
  let html = '';
  
  // 「前へ」ボタン
  html += `
    <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
      <a class="page-link" href="#" data-page="${currentPage - 1}" aria-label="Previous">
        <span aria-hidden="true">&laquo;</span>
      </a>
    </li>
  `;
  
  // ページ番号ボタン
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  // 表示するページ番号の調整
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  
  // 最初のページへのリンク（必要な場合）
  if (startPage > 1) {
    html += `
      <li class="page-item">
        <a class="page-link" href="#" data-page="1">1</a>
      </li>
    `;
    if (startPage > 2) {
      html += `
        <li class="page-item disabled">
          <span class="page-link">...</span>
        </li>
      `;
    }
  }
  
  // ページ番号ボタン
  for (let i = startPage; i <= endPage; i++) {
    html += `
      <li class="page-item ${i === currentPage ? 'active' : ''}">
        <a class="page-link" href="#" data-page="${i}">${i}</a>
      </li>
    `;
  }
  
  // 最後のページへのリンク（必要な場合）
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `
        <li class="page-item disabled">
          <span class="page-link">...</span>
        </li>
      `;
    }
    html += `
      <li class="page-item">
        <a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a>
      </li>
    `;
  }
  
  // 「次へ」ボタン
  html += `
    <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
      <a class="page-link" href="#" data-page="${currentPage + 1}" aria-label="Next">
        <span aria-hidden="true">&raquo;</span>
      </a>
    </li>
  `;
  
  // HTML更新とイベントリスナー設定
  paginationElement.innerHTML = html;
  
  // ページ番号クリックイベント
  paginationElement.querySelectorAll('.page-link[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = parseInt(e.target.closest('.page-link').getAttribute('data-page'), 10);
      
      if (page !== currentPage && page >= 1 && page <= totalPages) {
        currentPage = page;
        loadFilledTradeHistory();
      }
    });
  });
}

/**
 * リアルタイム更新の設定
 */
function setupRealtimeUpdates() {
  // 約定追加イベント
  realtimeUpdater.addListener('filled_trade_added', (tradeData) => {
    // フィルターに一致する場合のみ対応
    if (matchesFilters(tradeData)) {
      // 現在1ページ目を表示中の場合のみリアルタイム更新
      if (currentPage === 1) {
        prependTradeToTable(tradeData);
      }
      
      // 合計数を更新
      totalItems++;
      updatePaginationInfo(totalItems);
      updatePaginationControls(totalItems);
    }
  });
  
  // バッチ更新イベント
  realtimeUpdater.addListener('batch_update', (updates) => {
    if (Array.isArray(updates)) {
      let newItemsCount = 0;
      
      // 現在1ページ目表示中の場合のみテーブル更新
      if (currentPage === 1) {
        updates.forEach(update => {
          if (update.type === 'filled_trade_added' && matchesFilters(update.data)) {
            prependTradeToTable(update.data);
            newItemsCount++;
          }
        });
      } else {
        // 1ページ目以外ではフィルター一致数のみカウント
        newItemsCount = updates.filter(update => 
          update.type === 'filled_trade_added' && matchesFilters(update.data)
        ).length;
      }
      
      // 新しいアイテムがあれば合計数とページネーションを更新
      if (newItemsCount > 0) {
        totalItems += newItemsCount;
        updatePaginationInfo(totalItems);
        updatePaginationControls(totalItems);
      }
    }
  });
}

/**
 * 約定データがフィルターに一致するかチェック
 * @param {Object} trade - 約定データ
 * @returns {boolean} - フィルターに一致するか
 */
function matchesFilters(trade) {
  // フィルターが設定されていなければ常に一致
  if (Object.keys(currentFilters).length === 0) {
    return true;
  }
  
  // 各フィルター条件をチェック
  if (currentFilters.exchangeId && trade.exchangeId !== currentFilters.exchangeId) {
    return false;
  }
  
  if (currentFilters.symbol && trade.symbol !== currentFilters.symbol) {
    return false;
  }
  
  if (currentFilters.strategyKey && trade.strategyKey !== currentFilters.strategyKey) {
    return false;
  }
  
  if (currentFilters.side && trade.side !== currentFilters.side) {
    return false;
  }
  
  if (currentFilters.startDate && trade.timestamp < currentFilters.startDate) {
    return false;
  }
  
  if (currentFilters.endDate && trade.timestamp > currentFilters.endDate) {
    return false;
  }
  
  return true;
}

/**
 * テーブルの先頭に新しい約定行を追加
 * @param {Object} trade - 追加する約定データ
 */
function prependTradeToTable(trade) {
  const tableBody = document.querySelector('#filled-trades-history-table tbody');
  
  // 「データなし」の行がある場合は削除
  const noDataRow = tableBody.querySelector('td[colspan="11"]');
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
  
  // テーブルが現在のページサイズを超えたら最後の行を削除
  const rows = tableBody.querySelectorAll('tr');
  if (rows.length > pageSize) {
    tableBody.removeChild(rows[rows.length - 1]);
  }
}