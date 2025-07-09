$(document).ready(function() {
  // ナビゲーションバーを読み込む
  $('#navbar-container').load('navbar.html', function() {
    // 現在のページに対応するナビゲーションリンクをアクティブにする
    $('#nav-order-history').addClass('active');
  });

  let ordersTable;
  let exchanges = [];
  let symbols = [];

  // flatpickrの初期化
  flatpickr('.datepicker', {
    locale: 'ja',
    dateFormat: 'Y-m-d',
    allowInput: true
  });

  // 取引所と銘柄のフィルタオプションをロード
  function loadFilterOptions() {
    // バックエンドから取引所リストを取得
    fetch('/api/exchanges')
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        exchanges = data;
        const exchangeFilter = $('#filter-exchange');
        exchangeFilter.empty(); // 既存のオプションをクリア

        // 取引所のオプションを追加
        exchanges.forEach(ex => {
          exchangeFilter.append(`<option value="${ex}">${ex}</option>`);
        });

        // 最初の取引所を選択
        if (exchanges.length > 0) {
          exchangeFilter.val(exchanges[0]);
          // 選択された取引所の銘柄リストを取得
          loadSymbols(exchanges[0]);
          // 最初の取引所で履歴を検索
          loadOrders();
        }
      })
      .catch(error => {
        console.error('Error loading exchanges:', error);
      });
  }

  // 取引所に基づいて銘柄リストを取得
  function loadSymbols(exchange) {
    fetch(`/api/symbols?exchange=${exchange}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        symbols = data;
        const symbolFilter = $('#filter-symbol');
        symbolFilter.empty(); // 既存のオプションをクリア

        // 「全て」オプションを追加
        symbolFilter.append('<option value="">全て</option>');

        // 銘柄のオプションを追加
        symbols.forEach(sym => {
          symbolFilter.append(`<option value="${sym}">${sym}</option>`);
        });
      })
      .catch(error => {
        console.error('Error loading symbols:', error);
        // エラー時は空の銘柄リストを表示
        const symbolFilter = $('#filter-symbol');
        symbolFilter.empty();
        // 「全て」オプションのみ追加
        symbolFilter.append('<option value="">全て</option>');
      });
  }

  // 注文履歴データをロードしてDataTablesに表示
  function loadOrders() {
    const exchange = $('#filter-exchange').val();
    const symbol = $('#filter-symbol').val();
    const side = $('#filter-side').val();
    const startDate = $('#filter-start-date').val();
    const endDate = $('#filter-end-date').val();

    const params = new URLSearchParams();
    if (exchange) {
      params.append('exchange', exchange);
    }
    // 銘柄フィルタが空文字列の場合はフィルタリングしない
    if (symbol !== '') {
      if (symbol) {
        params.append('symbol', symbol);
      }
    }
    if (side) {
      params.append('side', side);
    }
    if (startDate) {
      params.append('startDate', startDate);
    }
    if (endDate) {
      params.append('endDate', endDate);
    }

    // APIエンドポイントからデータを取得
    fetch(`/api/orders?${params.toString()}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('APIから取得した生データ:', data); // デバッグ用ログ
        console.log('データ型:', typeof data, 'Array?', Array.isArray(data)); // データ型確認
        console.log('データ件数:', data ? data.length : 'null/undefined');

        // 最初の数件のデータ構造を詳細分析
        if (data && data.length > 0) {
          console.log('=== データ構造分析 ===');
          for (let i = 0; i < Math.min(3, data.length); i++) {
            const row = data[i];
            console.log(`データ${i+1}:`, row);
            console.log(`  - keys: [${Object.keys(row).join(', ')}]`);
            console.log(`  - exchange: "${row.exchange}" (type: ${typeof row.exchange})`);
            console.log(`  - orderId: "${row.orderId}" (type: ${typeof row.orderId})`);
            console.log(`  - id: "${row.id}" (type: ${typeof row.id})`);
            console.log(`  - _id: "${row._id}" (type: ${typeof row._id})`);
            console.log(`  - strategy: "${row.strategy}" (type: ${typeof row.strategy})`);
            console.log(`  - timestamp: "${row.timestamp}" (type: ${typeof row.timestamp})`);
          }
        }

        // Filter out incomplete data and add default values for missing fields
        const cleanedData = (data || []).filter(row => {
          // Ensure required fields exist - より緩い条件で試す
          const hasOrderId = row && (row.orderId || row.id || row._id);
          const hasExchange = row && row.exchange;

          if (!hasOrderId) {
            console.warn('Missing orderId field in row:', row);
          }
          if (!hasExchange) {
            console.warn('Missing exchange field in row:', row);
          }

          return hasOrderId && hasExchange;
        }).map(row => {
          // Normalize and provide defaults for missing fields
          return {
            exchange: row.exchange || 'Unknown',
            symbol: row.symbol || 'Unknown',
            side: row.side || 'Unknown',
            price: row.price || 0,
            amount: row.amount || 0,
            orderId: row.orderId || row.id || row._id || 'Unknown',
            orderType: row.orderType || row.type || 'Unknown',
            strategy: row.strategy || 'Unknown',
            timestamp: row.timestamp || row.datetime || row.date || Date.now()
          };
        });

        console.log('フィルタ後データ件数:', cleanedData.length);
        console.log('クリーニング後のデータ:', cleanedData); // デバッグ用ログ

        if (ordersTable) {
          ordersTable.destroy();
        }
        console.log('DataTablesに渡すデータ:', cleanedData); // デバッグ用ログ
        console.log('DataTables初期化直前'); // デバッグ用ログ
        ordersTable = $('#orders-table').DataTable({
          data: cleanedData,
          columns: [
            {
              data: 'exchange',
              defaultContent: 'Unknown',
              render: function(data) {
                return data || 'Unknown';
              }
            },
            {
              data: 'symbol',
              defaultContent: 'Unknown',
              render: function(data) {
                return data || 'Unknown';
              }
            },
            {
              data: 'side',
              defaultContent: 'Unknown',
              render: function(data) {
                return data || 'Unknown';
              }
            },
            {
              data: 'price',
              defaultContent: '0',
              render: function(data) {
                return data || '0';
              }
            },
            {
              data: 'amount',
              defaultContent: '0',
              render: function(data) {
                return data || '0';
              }
            },
            {
              data: 'orderId',
              defaultContent: 'Unknown',
              render: function(data) {
                return data || 'Unknown';
              }
            },
            {
              data: 'orderType',
              defaultContent: 'Unknown',
              render: function(data) {
                return data || 'Unknown';
              }
            },
            {
              data: 'strategy',
              defaultContent: 'Unknown',
              render: function(data) {
                return data || 'Unknown';
              }
            },
            {
              data: 'timestamp',
              defaultContent: 'Unknown',
              render: function(data) {
                try {
                  const date = new Date(data || Date.now());
                  return date.toLocaleString();
                } catch (error) {
                  return 'Invalid Date';
                }
              }
            }
          ],
          order: [[8, 'desc']] // タイムスタンプで降順ソート（カラム数が増えたのでインデックス修正）
        });
      })
      .catch(error => {
        console.error('Error loading orders:', error);
        console.error('API応答処理中にエラーが発生しました:', error); // デバッグ用ログ
        console.error('エラータイプ:', error.constructor.name);
        console.error('エラーメッセージ:', error.message);
        console.error('エラースタック:', error.stack);

        // エラー時に空のテーブルを表示
        if (ordersTable) {
          ordersTable.destroy();
        }
        ordersTable = $('#orders-table').DataTable({
          data: [],
          columns: [
            { data: 'exchange', defaultContent: 'No Data' },
            { data: 'symbol', defaultContent: 'No Data' },
            { data: 'side', defaultContent: 'No Data' },
            { data: 'price', defaultContent: 'No Data' },
            { data: 'amount', defaultContent: 'No Data' },
            { data: 'orderId', defaultContent: 'No Data' },
            { data: 'orderType', defaultContent: 'No Data' },
            { data: 'strategy', defaultContent: 'No Data' },
            { data: 'timestamp', defaultContent: 'No Data' }
          ]
        });
      });
  }

  // フィルタ適用ボタンのクリックイベント
  $('#apply-filter').on('click', function() {
    loadOrders();
  });

  // 取引所変更時に銘柄リストを更新
  $('#filter-exchange').on('change', function() {
    const selectedExchange = $(this).val();
    loadSymbols(selectedExchange);
  });

  // 初期ロード
  loadFilterOptions();
  loadOrders();
});