/**
 * Web UI 共通ユーティリティライブラリ
 * 複数の履歴画面で共有されるロジックを統合
 */

class CommonHistoryUtils {
  constructor() {
    this.exchanges = [];
    this.symbols = [];
  }

  /**
     * flatpickr日付ピッカーの初期化
     */
  initializeDatePickers() {
    flatpickr('.datepicker', {
      locale: 'ja',
      dateFormat: 'Y-m-d',
      allowInput: true
    });
  }

  /**
     * 取引所と銘柄のフィルタオプションをロード
     * @param {Function} searchCallback - データロード完了後に実行する検索コールバック
     */
  async loadFilterOptions(searchCallback) {
    try {
      // バックエンドから取引所リストを取得
      const response = await fetch('/api/exchanges');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      this.exchanges = data;
      const exchangeFilter = $('#filter-exchange');
      exchangeFilter.empty(); // 既存のオプションをクリア

      // 取引所のオプションを追加
      this.exchanges.forEach(ex => {
        exchangeFilter.append(`<option value="${ex}">${ex}</option>`);
      });

      // 最初の取引所を選択
      if (this.exchanges.length > 0) {
        exchangeFilter.val(this.exchanges[0]);
        // 選択された取引所の銘柄リストを取得
        await this.loadSymbols(this.exchanges[0]);
        // 最初の取引所で検索実行
        if (searchCallback) {
          searchCallback(this.exchanges[0]);
        }
      }
    } catch (error) {
      console.error('取引所オプション読み込みエラー:', error);
      this.showError('取引所リストの読み込みに失敗しました');
    }
  }

  /**
     * 選択された取引所の銘柄リストを取得
     * @param {string} exchange - 取引所名
     */
  async loadSymbols(exchange) {
    try {
      const response = await fetch(`/api/symbols?exchange=${exchange}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      this.symbols = data;
      const symbolFilter = $('#filter-symbol');
      symbolFilter.empty(); // 既存のオプションをクリア
      symbolFilter.append('<option value="">すべて</option>'); // 空白オプションを最初に追加

      // 銘柄のオプションを追加
      this.symbols.forEach(sym => {
        symbolFilter.append(`<option value="${sym}">${sym}</option>`);
      });
    } catch (error) {
      console.error('銘柄リスト読み込みエラー:', error);
      this.showError('銘柄リストの読み込みに失敗しました');
    }
  }

  /**
     * フィルタパラメータを取得
     * @returns {Object} フィルタパラメータ
     */
  getFilterParams() {
    return {
      exchange: $('#filter-exchange').val(),
      symbol: $('#filter-symbol').val(),
      startDate: $('#start-date').val(),
      endDate: $('#end-date').val(),
      limit: parseInt($('#limit-input').val()) || 100
    };
  }

  /**
     * データテーブルの初期化
     * @param {string} tableSelector - テーブルのjQueryセレクタ
     * @param {Array} columns - DataTablesカラム定義
     * @param {Object} options - 追加のDataTablesオプション
     */
  initializeDataTable(tableSelector, columns, options = {}) {
    const defaultOptions = {
      data: [],
      columns: columns,
      responsive: true,
      pageLength: 50,
      order: [[0, 'desc']], // 最初のカラム（通常は日時）で降順ソート
      language: {
        url: '//cdn.datatables.net/plug-ins/1.10.25/i18n/Japanese.json'
      },
      dom: 'Bfrtip',
      buttons: [
        'copy', 'csv', 'excel', 'pdf', 'print'
      ]
    };

    return $(tableSelector).DataTable({ ...defaultOptions, ...options });
  }

  /**
     * ローディングスピナーの表示/非表示
     * @param {boolean} show - true: 表示, false: 非表示
     */
  toggleLoadingSpinner(show) {
    if (show) {
      $('#loading-spinner').show();
    } else {
      $('#loading-spinner').hide();
    }
  }

  /**
     * エラーメッセージの表示
     * @param {string} message - エラーメッセージ
     */
  showError(message) {
    // Bootstrap Alert を使用してエラー表示
    const alertHtml = `
            <div class="alert alert-danger alert-dismissible fade show" role="alert">
                <strong>エラー:</strong> ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
    $('#alert-container').html(alertHtml);

    // 5秒後に自動で非表示
    setTimeout(() => {
      $('.alert').alert('close');
    }, 5000);
  }

  /**
     * 成功メッセージの表示
     * @param {string} message - 成功メッセージ
     */
  showSuccess(message) {
    const alertHtml = `
            <div class="alert alert-success alert-dismissible fade show" role="alert">
                <strong>成功:</strong> ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
    $('#alert-container').html(alertHtml);

    // 3秒後に自動で非表示
    setTimeout(() => {
      $('.alert').alert('close');
    }, 3000);
  }

  /**
     * 日時フォーマット（ISO文字列をローカル日時に変換）
     * @param {string} isoString - ISO 8601形式の日時文字列
     * @returns {string} フォーマットされた日時文字列
     */
  formatDateTime(isoString) {
    if (!isoString) {
      return '';
    }

    const date = new Date(isoString);
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
     * 数値フォーマット（カンマ区切り）
     * @param {number|string} value - フォーマットする数値
     * @param {number} decimals - 小数点以下の桁数
     * @returns {string} フォーマットされた数値文字列
     */
  formatNumber(value, decimals = 2) {
    if (value === null || value === undefined || value === '') {
      return '';
    }

    const num = parseFloat(value);
    if (isNaN(num)) {
      return value;
    }

    return num.toLocaleString('ja-JP', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  /**
     * 価格フォーマット（通貨表示）
     * @param {number|string} price - 価格
     * @returns {string} フォーマットされた価格文字列
     */
  formatPrice(price) {
    return '¥' + this.formatNumber(price, 0);
  }

  /**
     * パーセンテージフォーマット
     * @param {number|string} value - パーセンテージ値（0.1 = 10%）
     * @returns {string} フォーマットされたパーセンテージ文字列
     */
  formatPercentage(value) {
    if (value === null || value === undefined || value === '') {
      return '';
    }

    const num = parseFloat(value);
    if (isNaN(num)) {
      return value;
    }

    return (num * 100).toFixed(2) + '%';
  }

  /**
     * イベントハンドラーの設定
     * @param {Function} searchCallback - 検索実行コールバック
     */
  setupEventHandlers(searchCallback) {
    // 取引所変更時のイベント
    $('#filter-exchange').on('change', async (e) => {
      const selectedExchange = e.target.value;
      await this.loadSymbols(selectedExchange);
      if (searchCallback) {
        searchCallback();
      }
    });

    // 検索ボタンクリック
    $('#search-btn').on('click', () => {
      if (searchCallback) {
        searchCallback();
      }
    });

    // Enter キー押下で検索実行
    $('#start-date, #end-date, #limit-input').on('keypress', (e) => {
      if (e.which === 13 && searchCallback) {
        searchCallback();
      }
    });

    // データエクスポート機能の追加
    $('#export-csv').on('click', () => {
      this.exportTableToCSV();
    });
  }

  /**
     * データテーブルをCSVエクスポート
     */
  exportTableToCSV() {
    const table = $('.dataTable').DataTable();
    const data = table.buttons.exportData();

    let csvContent = '\uFEFF'; // BOM for UTF-8

    // ヘッダー行
    csvContent += data.header.join(',') + '\n';

    // データ行
    data.body.forEach(row => {
      csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    // ダウンロード
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `export_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// グローバルインスタンス
window.CommonHistoryUtils = CommonHistoryUtils;