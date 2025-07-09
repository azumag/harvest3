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
          // DataTablesがサーバーサイドモードで初期化時に自動的にデータを読み込むため、ここでは不要
          // loadSignals(); // loadOrders から loadSignals に変更 - 削除
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

  // シグナル履歴データをロードしてDataTablesに表示
  // DataTablesを初期化
  // サーバーサイド処理に変更
  signalsTable = $('#signals-table').DataTable({
    processing: true, // 処理中の表示
    serverSide: true, // サーバーサイド処理を有効化
    pageLength: 50, // 1ページあたりの表示件数を50に設定
    ajax: {
      url: '/api/signals', // APIエンドポイント
      type: 'GET',
      data: function (d) {
        // DataTablesが送信するパラメータ(d)にフィルタ条件を追加
        const exchange = $('#filter-exchange').val();
        const symbol = $('#filter-symbol').val();
        const side = $('#filter-side').val();
        const startDate = $('#filter-start-date').val();
        const endDate = $('#filter-end-date').val();

        if (exchange) {
          d.exchange = exchange;
        }
        if (symbol !== '') { // 銘柄フィルタが空文字列の場合はフィルタリングしない
          if (symbol) {
            d.symbol = symbol;
          }
        }
        if (side) {
          d.side = side;
        }
        if (startDate) {
          d.startDate = startDate;
        }
        if (endDate) {
          d.endDate = endDate;
        }

        // DataTablesのページング、ソート、検索パラメータはdに自動的に含まれる
        // d.start: 表示するレコードの開始インデックス
        // d.length: 1ページあたりの表示件数
        // d.order: ソート情報
        // d.search: 検索ボックスの情報 (今回は使用しないが含めておく)

        return d;
      },
      dataSrc: function (json) {
        // APIからのレスポンスデータをDataTablesが期待する形式に変換
        // バックエンドは { data: [...], recordsTotal: N, recordsFiltered: M } 形式を想定
        json.recordsTotal = json.recordsTotal;
        json.recordsFiltered = json.recordsFiltered;
        return json.data; // データ配列を返す
      },
      error: function (xhr, error, thrown) {
        console.error('DataTables Ajax error:', thrown);
        // エラーメッセージを表示するなどの処理
        alert('データの取得に失敗しました。');
      }
    },
    columns: [
      { data: 'symbol' },
      { data: 'strategy' },
      { data: 'side' },
      { data: 'price' },
      { // detail をJSON整形して表示
        data: 'detail',
        render: function(data) {
          return '<pre>' + JSON.stringify(data, null, 2) + '</pre>';
        }
      },
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

  // フィルタ適用ボタンのクリックイベント
  $('#apply-filter').on('click', function() {
    // DataTablesにデータを再読み込みさせる
    signalsTable.ajax.reload();
  });

  // 取引所変更時に銘柄リストを更新
  $('#filter-exchange').on('change', function() {
    const selectedExchange = $(this).val();
    loadSymbols(selectedExchange);
    // 取引所変更時もデータを再読み込み
    signalsTable.ajax.reload();
  });

  // 初期ロード
  loadFilterOptions();
  // DataTablesはserverSide: trueの場合、初期化時に自動的にajaxリクエストを送信するため、
  // ここでの signalsTable.ajax.reload() や loadSignals() の呼び出しは不要
  // loadSignals(); // 削除またはコメントアウト
});