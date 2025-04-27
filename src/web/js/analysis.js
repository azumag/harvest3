/**
 * 分析ページのJavaScript
 * ロウソク足チャートと戦略シグナルを表示する
 */

// API経由で戦略リストを取得するように修正されたため、静的なリストは削除

// Chart.jsでのカスタムプラグイン実装
// OHLCチャートを実装するプラグイン
const OhlcPlugin = {
    id: 'ohlcPlugin',
    beforeDatasetsDraw: (chart, args, options) => {
        // この時点では何もせず、データセットを非表示にしない
        console.log('OhlcPlugin - beforeDatasetsDraw called');
    },
    afterDatasetsDraw: (chart, args, options) => {
        console.log('OhlcPlugin - afterDatasetsDraw called');
        const { ctx } = chart;
        
        // データセットごとに処理
        chart.data.datasets.forEach((dataset, datasetIndex) => {
            // OHLCデータセットのみ処理
            if (dataset.ohlcData === true) {
                console.log('OhlcPlugin - Processing OHLC dataset:', datasetIndex);
                
                if (!dataset.data || dataset.data.length === 0) {
                    console.warn('OhlcPlugin - No data points');
                    return;
                }
                
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                
                if (!xScale || !yScale) {
                    console.warn('OhlcPlugin - Scales not available');
                    return;
                }
                
                // 各データポイントの処理
                dataset.data.forEach((dataPoint, index) => {
                    if (!dataPoint || !('o' in dataPoint) || !('h' in dataPoint) ||
                        !('l' in dataPoint) || !('c' in dataPoint)) {
                        console.warn(`OhlcPlugin - Invalid dataPoint at index ${index}:`, dataPoint);
                        return;
                    }
                    // X座標の計算
                    const xValue = dataPoint.x; // タイムスタンプ
                    const xPixel = xScale.getPixelForValue(xValue);
                    // Y座標の計算
                    const yOpen = yScale.getPixelForValue(dataPoint.o);
                    const yHigh = yScale.getPixelForValue(dataPoint.h);
                    const yLow = yScale.getPixelForValue(dataPoint.l);
                    const yClose = yScale.getPixelForValue(dataPoint.c);
                    // デバッグログ追加
                    console.log(`Candle[${index}] x=${xValue} xPixel=${xPixel} o=${dataPoint.o} yOpen=${yOpen} h=${dataPoint.h} yHigh=${yHigh} l=${dataPoint.l} yLow=${yLow} c=${dataPoint.c} yClose=${yClose}`);
                    // chartAreaのデバッグ
                    if (index === 0) {
                        console.log('chartArea:', chart.chartArea);
                        console.log('xScale:', xScale);
                        console.log('yScale:', yScale);
                    }
                    // ...既存の描画処理...
                    const isRising = dataPoint.c >= dataPoint.o;
                    const candleColor = isRising ? 'magenta' : 'cyan';
                    const totalBars = dataset.data.length;
                    const defaultWidth = 12;
                    const chartWidth = chart.chartArea.right - chart.chartArea.left;
                    const barWidth = Math.min(defaultWidth, chartWidth / totalBars * 0.8);
                    ctx.fillStyle = candleColor;
                    ctx.strokeStyle = candleColor;
                    const rectTop = Math.min(yOpen, yClose);
                    const rectHeight = Math.abs(yClose - yOpen);
                    ctx.fillRect(xPixel - barWidth / 2, rectTop, barWidth, rectHeight);
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.moveTo(xPixel, yHigh);
                    ctx.lineTo(xPixel, Math.min(yOpen, yClose));
                    ctx.moveTo(xPixel, Math.max(yOpen, yClose));
                    ctx.lineTo(xPixel, yLow);
                    ctx.stroke();
                });
            }
        });
    }
};

// Chart.js Financial拡張のコントローラ・エレメントのregisterは不要（CDNで自動登録されるため）
// const CandlestickController = Chart.CandlestickController || window.CandlestickController;
// const OhlcController = Chart.OhlcController || window.OhlcController;
// const FinancialElement = Chart.FinancialElement || window.FinancialElement;
// const FinancialScale = Chart.FinancialScale || window.FinancialScale;
// const PointController = Chart.PointController || window.PointController;
// const PointElement = Chart.PointElement || window.PointElement;

// Chart.register(
//     CandlestickController,
//     OhlcController,
//     FinancialElement,
//     FinancialScale,
//     PointController,
//     PointElement
// );
// カスタムOhlcPluginのregisterは不要なので削除
// Chart.register(OhlcPlugin);
// console.log('Chart.js registered plugins:', Chart.plugins);
 
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
    // filter-end-dateの初期化は不要
    document.getElementById('filter-start-date').value = '';
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
    const limit = document.getElementById('filter-limit').value;
    // endDateは使わない

    // 必須フィールドの検証
    if (!exchange || !symbol) {
        showError('取引所と銘柄を選択してください');
        return;
    }

    // ローディング表示
    showLoading(true);
    hideError();

    try {
        console.log('fetchDataAndRenderChart - Fetching OHLCV data...');
        // ロウソク足データの取得
        const ohlcvData = await fetchOhlcvData(exchange, symbol, timeframe, limit, startDate);
        console.log('fetchDataAndRenderChart - OHLCV data fetched.', ohlcvData.length, 'points.');
        if (ohlcvData.length > 0) {
            console.log('OHLCV data sample [0]:', ohlcvData[0]);
            console.log('OHLCV data sample [last]:', ohlcvData[ohlcvData.length - 1]);
        }
        // 戦略シグナルデータの取得 (戦略が選択されている場合)
        let signalData = [];
        if (strategy) {
            console.log('fetchDataAndRenderChart - Fetching signal data...');
            signalData = await fetchStrategySignals(exchange, symbol, strategy, startDate);
            console.log('fetchDataAndRenderChart - Signal data fetched.', signalData.length, 'points.');
        }
        if (ohlcvData.length === 0) {
            console.log('fetchDataAndRenderChart - No OHLCV data received.');
            showNoDataMessage(true);
            showLoading(false);
            return;
        }
        console.log('fetchDataAndRenderChart - Rendering chart...');
        renderChart(ohlcvData, signalData);
        console.log('fetchDataAndRenderChart - Chart rendered.');
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
async function fetchOhlcvData(exchange, symbol, timeframe, limit, startDate) {
    try {
        // 日付をミリ秒のタイムスタンプに変換
        let startTime = startDate ? new Date(startDate).getTime() : undefined;
        // APIリクエストパラメータの構築
        const params = new URLSearchParams({
            exchange,
            symbol,
            interval: timeframe
        });
        if (limit) params.append('limit', limit);
        if (startTime) params.append('startTime', startTime);
        // APIリクエスト
        const response = await fetch(`/api/ohlcv?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        console.log('fetchOhlcvData - Raw data:', data);
        if (data && data.length > 0) {
            console.log('Data type check:', {
                isArray: Array.isArray(data),
                firstItem: data[0],
                firstItemType: typeof data[0],
                firstTimestamp: data[0] ? data[0][0] : null,
                timestampType: data[0] ? typeof data[0][0] : null
            });
        }
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
 * @param {Array} ohlcvData - ロウソく足データ
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
    // デバッグログ
    console.log('renderChart - Creating chart with datasets:', {
        ohlc: ohlcDataset,
        signals: signalDatasets
    });
    const chart = new Chart(ctx, {
        type: 'candlestick',
        data: {
            datasets: [
                ohlcDataset,
                ...signalDatasets
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'nearest',
                intersect: false
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        tooltipFormat: 'dd HH:mm',
                        displayFormats: { day: 'dd HH:mm' }
                    },
                    title: { display: true, text: '日付' }
                },
                y: {
                    position: 'right',
                    title: { display: true, text: '価格' }
                }
            },
            plugins: {
                legend: { display: true, position: 'top' },
                annotation: { annotations: {} }
            }
        }
    });
    // シグナルアノテーションを追加
    addSignalsToChart(chart, signalData);
    console.log('renderChart - ohlcDataset type:', ohlcDataset.type);
}

/**
 * シグナルデータをChart.jsアノテーションとして追加
 */
function addSignalsToChart(chart, signalData) {
    if (!chart || !signalData || signalData.length === 0) return;
    // Chart.jsアノテーションプラグインが有効か確認
    if (!chart.options.plugins.annotation) {
        chart.options.plugins.annotation = { annotations: {} };
    }
    const annotations = {};
    signalData.forEach((signal, idx) => {
        if (!signal.side || !signal.timestamp || !signal.price) return;
        const isBuy = signal.side === 'buy';
        annotations[`signal-${idx}`] = {
            type: 'point',
            xValue: signal.timestamp,
            yValue: signal.price,
            backgroundColor: isBuy ? 'rgba(40,167,69,1)' : 'rgba(220,53,69,1)',
            borderColor: 'white',
            borderWidth: 2,
            radius: 10,
            pointStyle: isBuy ? 'triangle' : 'triangle-down',
            yAdjust: isBuy ? 10 : -10,
            label: {
                display: false
            },
            tooltip: {
                enabled: true,
                callbacks: {
                    title: () => (isBuy ? '買いシグナル' : '売りシグナル'),
                    label: () => [
                        `時間: ${new Date(signal.timestamp).toLocaleString('ja-JP')}`,
                        `価格: ${signal.price}`,
                        `戦略: ${signal.strategy || ''}`
                    ]
                }
            }
        };
    });
    chart.options.plugins.annotation.annotations = annotations;
    chart.update();
}

function prepareOhlcDataset(ohlcvData) {
    if (!Array.isArray(ohlcvData) || ohlcvData.length === 0) {
        console.warn('prepareOhlcDataset - Empty or invalid ohlcvData:', ohlcvData);
        return {
            label: 'ロウソク足 (データなし)',
            data: [],
            type: 'candlestick',
        };
    }
    // 公式拡張形式に変換
    const formatted = ohlcvData.map(item => ({
        x: item[0], o: item[1], h: item[2], l: item[3], c: item[4]
    }));
    console.log('prepareOhlcDataset - First formatted data item:', formatted[0]);
    console.log('prepareOhlcDataset - Total formatted items:', formatted.length);
    return {
        label: 'ローソク足',
        data: formatted,
        type: 'candlestick',
        color: { up: '#26a69a', down: '#ef5350', unchanged: '#ccc' }
    };
}

function prepareSignalDatasets(signalData) {
    if (!Array.isArray(signalData) || signalData.length === 0) return [];
    // buy/sellで色分け
    const buySignals = signalData.filter(s => s.side === 'buy');
    const sellSignals = signalData.filter(s => s.side === 'sell');
    const buyDataset = buySignals.length > 0 ? {
        label: 'Buyシグナル',
        type: 'scatter',
        data: buySignals.map(s => ({ x: s.timestamp, y: s.price })),
        backgroundColor: 'green',
        pointRadius: 6,
        showLine: false
    } : null;
    const sellDataset = sellSignals.length > 0 ? {
        label: 'Sellシグナル',
        type: 'scatter',
        data: sellSignals.map(s => ({ x: s.timestamp, y: s.price })),
        backgroundColor: 'red',
        pointRadius: 6,
        showLine: false
    } : null;
    return [buyDataset, sellDataset].filter(Boolean);
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

// Chart.js v4 CDN環境で全ての標準コントローラ・エレメントを一括登録
if (window.Chart && Chart.registerables) {
    Chart.register(...Chart.registerables);
}