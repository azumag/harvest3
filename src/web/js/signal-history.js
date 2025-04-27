$(document).ready(function() {
    // ナビゲーションバーを読み込む
    $('#navbar-container').load('navbar.html', function() {
        // 現在のページに対応するナビゲーションリンクをアクティブにする
        // TODO: ナビゲーションバーのHTMLに合わせてIDを修正する必要があるかもしれません
        $('#nav-signal-history').addClass('active');
    });

    let signalsTable; // ordersTable から signalsTable に変更
    let exchanges = [];
    let symbols = [];

    // flatpickrの初期化
    flatpickr(".datepicker", {
        locale: "ja",
        dateFormat: "Y-m-d",
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
                    loadSignals(); // loadOrders から loadSignals に変更
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
                symbolFilter.append(`<option value="">全て</option>`);

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
                symbolFilter.append(`<option value="">全て</option>`);
            });
    }

    // シグナル履歴データをロードしてDataTablesに表示
    function loadSignals() { // loadOrders から loadSignals に変更
        const exchange = $('#filter-exchange').val();
        const symbol = $('#filter-symbol').val();
        const side = $('#filter-side').val();
        const startDate = $('#filter-start-date').val();
        const endDate = $('#filter-end-date').val();

        const params = new URLSearchParams();
        if (exchange) params.append('exchange', exchange);
        // 銘柄フィルタが空文字列の場合はフィルタリングしない
        if (symbol !== '') {
            if (symbol) params.append('symbol', symbol);
        }
        if (side) params.append('side', side);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);

        // APIエンドポイントからデータを取得 (orders から signals に変更)
        fetch(`/api/signals?${params.toString()}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // DataTablesを初期化またはデータをクリアして追加
                if (signalsTable) { // ordersTable から signalsTable に変更
                    signalsTable.destroy(); // ordersTable から signalsTable に変更
                }
                signalsTable = $('#signals-table').DataTable({ // ordersTable から signalsTable に変更, #orders-table から #signals-table に変更
                    data: data,
                    columns: [
                        { data: 'exchange' },
                        { data: 'symbol' },
                        { data: 'side' },
                        { data: 'price' },
                        { data: 'detail' }, // detail を追加
                        {
                            data: 'timestamp',
                            render: function(data) {
                                // タイムスタンプを読める形式に変換 (ミリ秒を想定)
                                const date = new Date(data);
                                return date.toLocaleString(); // または好みの形式にフォーマット
                            }
                        }
                    ],
                    order: [[5, 'desc']] // タイムスタンプで降順ソート (カラム数が変わったためインデックスを調整)
                });
            })
            .catch(error => {
                console.error('Error loading signals:', error); // orders から signals に変更
                // エラーメッセージを表示するなどの処理
            });
    }

    // フィルタ適用ボタンのクリックイベント
    $('#apply-filter').on('click', function() {
        loadSignals(); // loadOrders から loadSignals に変更
    });

    // 取引所変更時に銘柄リストを更新
    $('#filter-exchange').on('change', function() {
        const selectedExchange = $(this).val();
        loadSymbols(selectedExchange);
    });

    // 初期ロード
    loadFilterOptions();
    loadSignals(); // loadOrders から loadSignals に変更
});