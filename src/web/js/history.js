$(document).ready(function() {
    // ナビゲーションバーを読み込む
    $('#navbar-container').load('navbar.html', function() {
        // 現在のページに対応するナビゲーションリンクをアクティブにする
        $('#nav-history').addClass('active');
    });

    let ordersTable;
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
        // TODO: バックエンドから取引所と銘柄のリストを取得するAPIエンドポイントが必要
        // 現在は仮のデータを使用
        exchanges = ['binance', 'coinbase', 'kraken']; // 仮データ
        symbols = ['BTC/USDT', 'ETH/USDT', 'XRP/USDT']; // 仮データ

        const exchangeFilter = $('#filter-exchange');
        exchanges.forEach(ex => {
            exchangeFilter.append(`<option value="${ex}">${ex}</option>`);
        });

        const symbolFilter = $('#filter-symbol');
        symbols.forEach(sym => {
            symbolFilter.append(`<option value="${sym}">${sym}</option>`);
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
        if (exchange) params.append('exchange', exchange);
        if (symbol) params.append('symbol', symbol);
        if (side) params.append('side', side);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);

        // APIエンドポイントからデータを取得
        fetch(`/api/orders?${params.toString()}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // DataTablesを初期化またはデータをクリアして追加
                if (ordersTable) {
                    ordersTable.destroy();
                }
                ordersTable = $('#orders-table').DataTable({
                    data: data,
                    columns: [
                        { data: 'exchange' },
                        { data: 'symbol' },
                        { data: 'side' },
                        { data: 'price' },
                        { data: 'amount' },
                        { data: 'orderId' },
                        { data: 'orderType' },
                        {
                            data: 'timestamp',
                            render: function(data) {
                                // タイムスタンプを読める形式に変換 (ミリ秒を想定)
                                const date = new Date(data);
                                return date.toLocaleString(); // または好みの形式にフォーマット
                            }
                        }
                    ],
                    order: [[7, 'desc']] // タイムスタンプで降順ソート
                });
            })
            .catch(error => {
                console.error('Error loading orders:', error);
                // エラーメッセージを表示するなどの処理
            });
    }

    // フィルタ適用ボタンのクリックイベント
    $('#apply-filter').on('click', function() {
        loadOrders();
    });

    // 初期ロード
    loadFilterOptions();
    loadOrders();
});