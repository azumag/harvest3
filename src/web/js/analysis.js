/**
 * 分析ページのJavaScript
 * ロウソク足チャートと戦略シグナルを表示する
 */

// API経由で戦略リストを取得するように修正されたため、静的なリストは削除

// カスタムOHLCチャートコントローラーの定義
class OhlcChartController extends Chart.controllers.bar {
    // コントローラーのIDを静的に定義
    static id = 'ohlc';

    draw() {
        // 元のbarチャートの描画ロジックを呼び出す（オプション）
        // super.draw();

        // カスタム描画ロジック
        const ctx = this.chart.ctx;
        const meta = this.getMeta();
        console.log('OhlcChartController.draw - meta.data:', meta.data); // ログ追加

        meta.data.forEach((element, index) => {
            const dataset = this.getDataset();
            const dataPoint = dataset.data[index];
            console.log(`OhlcChartController.draw - dataPoint[${index}]:`, dataPoint); // ログ追加
            const x = element.x;
            const yScale = this.chart.scales[meta.yAxisID];
            const width = element.width; // Chart.jsが計算したバーの幅を使用

            // ロウソク足の本体（矩形）を描画
            const yOpen = yScale.getPixelForValue(dataPoint.o);
            const yClose = yScale.getPixelForValue(dataPoint.c);
            const height = Math.abs(yClose - yOpen);

            ctx.fillStyle = dataPoint.c >= dataPoint.o ? 'green' : 'red';
            ctx.fillRect(x - width / 2, Math.min(yOpen, yClose), width, height);

            // ヒゲ（高値と安値）を描画
            ctx.strokeStyle = dataPoint.c >= dataPoint.o ? 'green' : 'red';
            ctx.lineWidth = 1; // ヒゲの線の太さ
            ctx.beginPath();
            // 上ヒゲ
            ctx.moveTo(x, yScale.getPixelForValue(dataPoint.h));
            ctx.lineTo(x, Math.min(yOpen, yClose));
            // 下ヒゲ
            ctx.moveTo(x, Math.max(yOpen, yClose));
            ctx.lineTo(x, yScale.getPixelForValue(dataPoint.l));
            ctx.stroke();
        });
    }
}

// カスタムコントローラーをChart.jsに登録
// 静的なidプロパティを使用
Chart.register({ ohlc: OhlcChartController }); // カスタムコントローラーの登録方法を修正
console.log('Chart.js registered controllers:', Chart.controllers); // ログ追加
 
document.addEventListener('DOMContentLoaded', function() {
    // Flatpickrの初期化 (日付選択)
    initializeDatepickers();

    // ドロップダウンの初期化
    initializeDropdowns();

    // イベントリスナーの設定
    setupEventListeners();
});

/**
 * Flatpickrを使用した日付選択の初期化
 */
function initializeDatepickers() {
    const datepickerConfig = {
        dateFormat: 'Y-m-d',
        locale: 'ja',
        maxDate: 'today'
    };
    
    flatpickr('#filter-start-date', datepickerConfig);
    flatpickr('#filter-end-date', datepickerConfig);
    
    // デフォルトでは1ヶ月前から今日までの期間を設定
    const today = new Date();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    document.getElementById('filter-end-date').value = formatDate(today);
    document.getElementById('filter-start-date').value = formatDate(oneMonthAgo);
}

/**
 * 日付をYYYY-MM-DD形式にフォーマット
 */
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * ドロップダウンの初期化
 */
async function initializeDropdowns() {
    try {
        // 取引所リストの取得と設定
        await fetchAndPopulateExchanges();
        
        // 取引所が選択されたら、銘柄リストを取得して設定
        const exchangeSelect = document.getElementById('filter-exchange');
        exchangeSelect.addEventListener('change', async () => {
            await fetchAndPopulateSymbols(exchangeSelect.value);
        });
        
        // 戦略リストの設定 (APIから取得)
        await populateStrategies();
    } catch (error) {
        console.error('ドロップダウンの初期化中にエラーが発生しました:', error);
        showError('データの読み込みに失敗しました。ページを再読み込みしてください。');
    }
}

/**
 * 取引所リストを取得し、ドロップダウンを設定
 */
async function fetchAndPopulateExchanges() {
    try {
        const response = await fetch('/api/exchanges');
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const exchanges = await response.json();
        const exchangeSelect = document.getElementById('filter-exchange');
        
        // 既存のオプションをクリア (最初のデフォルトオプションを除く)
        exchangeSelect.innerHTML = '<option value="">取引所を選択</option>';
        
        // 取引所オプションを追加
        exchanges.forEach(exchange => {
            const option = document.createElement('option');
            option.value = exchange;
            option.textContent = exchange;
            exchangeSelect.appendChild(option);
        });
    } catch (error) {
        console.error('取引所データの取得に失敗しました:', error);
        throw error;
    }
}

/**
 * 銘柄リストを取得し、ドロップダウンを設定
 */
async function fetchAndPopulateSymbols(exchange) {
    if (!exchange) {
        // 取引所が選択されていない場合はドロップダウンをクリア
        const symbolSelect = document.getElementById('filter-symbol');
        symbolSelect.innerHTML = '<option value="">銘柄を選択</option>';
        symbolSelect.disabled = true;
        return;
    }
    
    try {
        const response = await fetch(`/api/symbols?exchange=${encodeURIComponent(exchange)}`);
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const symbols = await response.json();
        const symbolSelect = document.getElementById('filter-symbol');
        
        // 既存のオプションをクリア
        symbolSelect.innerHTML = '<option value="">銘柄を選択</option>';
        symbolSelect.disabled = false;
        
        // 銘柄オプションを追加
        symbols.forEach(symbol => {
            const option = document.createElement('option');
            option.value = symbol;
            option.textContent = symbol;
            symbolSelect.appendChild(option);
        });
    } catch (error) {
        console.error('銘柄データの取得に失敗しました:', error);
        const symbolSelect = document.getElementById('filter-symbol');
        symbolSelect.innerHTML = '<option value="">取得できませんでした</option>';
        symbolSelect.disabled = true;
    }
}

/**
 * 戦略リストを取得し、ドロップダウンを設定
 * src/config.jsから定義された戦略一覧を取得
 */
async function populateStrategies() {
    try {
        const response = await fetch('/api/strategies');
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const strategies = await response.json();
        const strategySelect = document.getElementById('filter-strategy');
        
        // 既存のオプションをクリア
        strategySelect.innerHTML = '<option value="">戦略を選択</option>';
        
        // 戦略オプションを追加
        strategies.forEach(strategy => {
            const option = document.createElement('option');
            option.value = strategy;
            
            // 戦略名を表示用に整形（必要に応じてカスタマイズ）
            let displayName = strategy;
            
            option.textContent = displayName;
            strategySelect.appendChild(option);
        });
    } catch (error) {
        console.error('戦略リストの取得に失敗しました:', error);
        // エラー時はデフォルトの選択肢のみ表示
        const strategySelect = document.getElementById('filter-strategy');
        strategySelect.innerHTML = '<option value="">戦略を取得できませんでした</option>';
    }
}

/**
 * イベントリスナーの設定
 */
function setupEventListeners() {
    // 「表示」ボタンクリック時のイベント
    document.getElementById('apply-filter').addEventListener('click', async () => {
        await fetchDataAndRenderChart();
    });
}

/**
 * データを取得してチャートを描画
 */
async function fetchDataAndRenderChart() {
    const exchange = document.getElementById('filter-exchange').value;
    const symbol = document.getElementById('filter-symbol').value;
    const strategy = document.getElementById('filter-strategy').value;
    const timeframe = document.getElementById('filter-timeframe').value;
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;
    const limit = document.getElementById('filter-limit').value;
    
    // 必須フィールドの検証
    if (!exchange || !symbol) {
        showError('取引所と銘柄を選択してください');
        return;
    }
    
    // ローディング表示
    showLoading(true);
    hideError();
    
    try {
        console.log('fetchDataAndRenderChart - Fetching OHLCV data...'); // ログ追加
        // ロウソク足データの取得
        const ohlcvData = await fetchOhlcvData(exchange, symbol, timeframe, limit, startDate, endDate);
        console.log('fetchDataAndRenderChart - OHLCV data fetched.', ohlcvData.length, 'points.'); // ログ追加
        
        // 戦略シグナルデータの取得 (戦略が選択されている場合)
        let signalData = [];
        if (strategy) {
            console.log('fetchDataAndRenderChart - Fetching signal data...'); // ログ追加
            signalData = await fetchStrategySignals(exchange, symbol, strategy, startDate, endDate);
            console.log('fetchDataAndRenderChart - Signal data fetched.', signalData.length, 'points.'); // ログ追加
        }
        
        // データが取得できたかチェック
        if (ohlcvData.length === 0) {
            console.log('fetchDataAndRenderChart - No OHLCV data received.'); // ログ追加
            showNoDataMessage(true);
            showLoading(false);
            return;
        }
        
        console.log('fetchDataAndRenderChart - Rendering chart...'); // ログ追加
        // チャートの描画
        renderChart(ohlcvData, signalData);
        console.log('fetchDataAndRenderChart - Chart rendered.'); // ログ追加
        showNoDataMessage(false);
    } catch (error) {
        console.error('データ取得中にエラーが発生しました:', error);
        showError('データの取得に失敗しました。入力条件を確認してください。');
    } finally {
        showLoading(false);
    }
}

/**
 * ロウソク足データの取得
 */
async function fetchOhlcvData(exchange, symbol, timeframe, limit, startDate, endTime) {
    try {
        // 日付をミリ秒のタイムスタンプに変換
        let startTime = startDate ? new Date(startDate).getTime() : undefined;
        let endTimeMs = endTime ? new Date(endTime).getTime() + (24 * 60 * 60 * 1000 - 1) : undefined; // 終了日の終わり (23:59:59.999)
        
        // APIリクエストパラメータの構築
        const params = new URLSearchParams({
            exchange,
            symbol,
            interval: timeframe,
            limit
        });
        
        if (startTime) params.append('startTime', startTime);
        // endTimeはcxxtでは通常使用しないが、APIが対応している場合に備えてコメントアウト
        // if (endTimeMs) params.append('endTime', endTimeMs);
        
        // APIリクエスト
        const response = await fetch(`/api/ohlcv?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('fetchOhlcvData - Raw data:', data); // ログ追加
        return data;
    } catch (error) {
        console.error('ロウソク足データの取得に失敗しました:', error);
        throw error;
    }
}

/**
 * 戦略シグナルデータの取得
 */
async function fetchStrategySignals(exchange, symbol, strategy, startDate, endDate) {
    try {
        // APIリクエストパラメータの構築
        const params = new URLSearchParams({
            exchange,
            symbol
        });
        
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        
        // APIリクエスト
        const response = await fetch(`/api/signals?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // データがDataTables形式（data配列を含む）かどうかをチェック
        const signals = Array.isArray(result) ? result : (result.data || []);
        
        // 戦略名でフィルタリング (APIが対応していない場合はクライアント側でフィルタリング)
        return signals.filter(signal => signal.strategy === strategy);
    } catch (error) {
        console.error('戦略シグナルデータの取得に失敗しました:', error);
        throw error;
    }
}

/**
 * チャートの描画
 * @param {Array} ohlcvData - ロウソク足データ
 * @param {Array} signalData - 戦略シグナルデータ
 */
function renderChart(ohlcvData, signalData) {
    // 既存のチャートがあれば破棄
    const chartElement = document.getElementById('ohlcvChart');
    const chartInstance = Chart.getChart(chartElement);
    if (chartInstance) {
        chartInstance.destroy();
    }
    
    // ロウソク足データの整形
    const ohlcDataset = prepareOhlcDataset(ohlcvData);
    // シグナルデータの整形
    const signalDatasets = prepareSignalDatasets(signalData);
    
    // チャートの作成
    const ctx = chartElement.getContext('2d');
    new Chart(ctx, {
        type: 'ohlc', // カスタムOHLCチャートタイプを使用
        data: {
            datasets: [
                ohlcDataset,
                ...signalDatasets
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day', // 必要に応じて時間足に合わせて変更
                        displayFormats: {
                            day: 'MM/dd' // 必要に応じて時間足に合わせて変更
                        }
                    },
                    title: {
                        display: true,
                        text: '日付'
                    }
                },
                y: {
                    position: 'right',
                    title: {
                        display: true,
                        text: '価格'
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const dataset = context.dataset;
                            const dataIndex = context.dataIndex;

                            if (dataset.type === 'ohlc') {
                                const data = dataset.data[dataIndex];
                                return [
                                    `始値: ${data.o}`,
                                    `高値: ${data.h}`,
                                    `安値: ${data.l}`,
                                    `終値: ${data.c}`
                                ];
                            } else if (dataset.type === 'signal') {
                                const data = dataset.data[dataIndex];
                                return [
                                    `${data.side === 'buy' ? '買いシグナル' : '売りシグナル'}`,
                                    `価格: ${data.price}`
                                ];
                            }
                            return context.formattedValue;
                        }
                    }
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            }
        }
    });
    console.log('renderChart - ohlcDataset type:', ohlcDataset.type); // ログ追加
}

/**
 * ロウソク足データセットの準備
 */
function prepareOhlcDataset(ohlcvData) {
    // CCXT形式のOHLCVデータから必要なデータを抽出して整形
    const formattedData = ohlcvData.map(candle => {
        // CCXT OHLCV形式: [timestamp, open, high, low, close, volume]
        const [timestamp, open, high, low, close] = candle;

        return {
            x: timestamp, // タイムスタンプ (ミリ秒)
            o: open,      // 始値
            h: high,      // 高値
            l: low,       // 安値
            c: close,     // 終値
        };
    });
    console.log('prepareOhlcDataset - Formatted data:', formattedData); // ログ追加

    return {
        label: 'ロウソク足',
        data: formattedData,
        type: 'ohlc' // ロウソク足チャートタイプを指定
        // カスタムOHLCコントローラーが描画を担当するため、ここでは描画関連の設定は不要
    };
}

/**
 * シグナルデータセットの準備
 */
function prepareSignalDatasets(signalData) {
    // 買いシグナルと売りシグナルを分離
    const buySignals = signalData.filter(signal => signal.side === 'buy');
    const sellSignals = signalData.filter(signal => signal.side === 'sell');
    
    // 買いシグナルのデータセット
    const buyDataset = {
        label: '買いシグナル',
        type: 'signal', // カスタムタイプ識別用
        data: buySignals.map(signal => ({
            x: signal.timestamp,
            y: signal.price,
            side: 'buy',
            price: signal.price,
            details: signal.details || '',
            timestamp: signal.timestamp
        })),
        pointStyle: 'triangle',
        pointRadius: 10,
        pointBackgroundColor: 'rgba(0, 255, 0, 0.5)',
        pointBorderColor: 'green',
        showLine: false
    };
    
    // 売りシグナルのデータセット
    const sellDataset = {
        label: '売りシグナル',
        type: 'signal', // カスタムタイプ識別用
        data: sellSignals.map(signal => ({
            x: signal.timestamp,
            y: signal.price,
            side: 'sell',
            price: signal.price,
            details: signal.details || '',
            timestamp: signal.timestamp
        })),
        pointStyle: 'triangle',
        pointRadius: 10,
        pointRotation: 180, // 三角形を反転
        pointBackgroundColor: 'rgba(255, 0, 0, 0.5)',
        pointBorderColor: 'red',
        showLine: false
    };
    
    // データが存在するデータセットのみを返す
    return [
        ...(buySignals.length > 0 ? [buyDataset] : []),
        ...(sellSignals.length > 0 ? [sellDataset] : [])
    ];
}

/**
 * ローディング表示の制御
 */
function showLoading(show) {
    const loading = document.getElementById('chart-loading');
    if (show) {
        loading.classList.remove('d-none');
    } else {
        loading.classList.add('d-none');
    }
}

/**
 * エラーメッセージの表示
 */
function showError(message) {
    const errorElement = document.getElementById('chart-error');
    errorElement.textContent = message;
    errorElement.classList.remove('d-none');
}

/**
 * エラーメッセージの非表示
 */
function hideError() {
    const errorElement = document.getElementById('chart-error');
    errorElement.classList.add('d-none');
}

/**
 * データなしメッセージの表示
 */
function showNoDataMessage(show) {
    const noDataElement = document.getElementById('no-data-message');
    if (show) {
        noDataElement.classList.remove('d-none');
    } else {
        noDataElement.classList.add('d-none');
    }
}