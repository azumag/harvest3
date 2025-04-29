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
    // 今日の日付を基準日に設定
    document.getElementById('filter-start-date').value = formatDate(new Date());
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
 * データを取得してチャートを描画（更新版）
 */
async function fetchDataAndRenderChart() {
    const parameterSetSelect = document.getElementById('filter-parameter-set');

    if (!parameterSetSelect.value) {
        showError('パラメータセットを選択してください');
        return;
    }

    // 表示されている値を使用して取得するように変更（要素が存在するかチェック）
    const exchangeElement = document.getElementById('selected-exchange');
    const symbolElement = document.getElementById('selected-symbol');
    const strategyElement = document.getElementById('selected-strategy');
    const timeframeElement = document.getElementById('selected-timeframe');
    const limitElement = document.getElementById('selected-limit');
    
    // 要素が存在しない場合はエラーを表示して処理を中止
    if (!exchangeElement || !symbolElement || !strategyElement) {
        showError('必要な要素が見つかりません。パラメータセットを選択してください。');
        return;
    }

    const exchange = exchangeElement.textContent;
    const symbol = symbolElement.textContent; 
    const strategy = strategyElement.textContent;

    // 時間足と表示数（存在チェック付き）
    const timeframe = timeframeElement ? timeframeElement.textContent : '1h';
    const limit = limitElement ? limitElement.textContent : '100';

    // 内容が空の場合もエラー
    if (!exchange || !symbol || !strategy) {
        showError('取引所、銘柄、戦略が正しく設定されていません。パラメータセットを選択してください。');
        return;
    }

    // 日付はデフォルトで現在時刻を使用
    const startDate = document.getElementById('filter-start-date').value || formatDate(new Date());

    // ローディング表示
    // showLoading(true); // Re-enable loading display
    hideError();

    try {
        // ロウソク足データの取得
        const ohlcvData = await fetchOhlcvData(exchange, symbol, timeframe, limit, startDate);

        // 戦略シグナルデータの取得
        let signalData = [];
        if (strategy) {
            signalData = await fetchStrategySignals(exchange, symbol, strategy, startDate);
        }

        if (ohlcvData.length === 0) {
            showNoDataMessage(true);
            // showLoading(false);
            hideLoading();
            return;
        }

        renderChart(ohlcvData, signalData);
        showNoDataMessage(false);
    } catch (error) {
        console.error('データ取得中にエラーが発生しました:', error);
        showError('データの取得に失敗しました。入力条件を確認してください。');
    } finally {
        // showLoading(false);
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
            timeframe
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
        hideLoading();
        return data;
    } catch (error) {
        console.error('ロウソク足データの取得に失敗しました:', error);
        throw error;
    } finally {
        hideLoading();
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
 * パラメータセットを読み込み、セレクトボックスに表示する
 */
async function loadParameterSets() {
    try {
        // showLoading();
        
        const response = await fetch('/api/all-parameters');
        
        if (!response.ok) {
            throw new Error('パラメータセットの取得に失敗しました');
        }
        
        const allParameters = await response.json();
        const parameterSetSelect = document.getElementById('filter-parameter-set');
        
        // セレクトボックスをクリア（最初のオプションは残す）
        const defaultOption = parameterSetSelect.options[0];
        parameterSetSelect.innerHTML = '';
        parameterSetSelect.appendChild(defaultOption);
        
        // パラメータセット一覧を準備
        const parameterSets = new Map(); // 重複を避けるためにMapを使用
        
        // パラメータをグループ化
        for (const paramKey in allParameters) {
            if (allParameters.hasOwnProperty(paramKey)) {
                const parts = paramKey.split(':');
                if (parts.length === 4 && parts[0] === 'params') {
                    const exchangeId = parts[1];
                    const symbol = parts[2];
                    const strategyKey = parts[3];
                    
                    // パラメータセット名を作成 (例: binance:BTC/USDT:MovingAverageCrossover)
                    const setName = `${exchangeId}:${symbol}:${strategyKey}`;
                    const displayName = `${exchangeId} - ${symbol} - ${strategyKey}`;
                    
                    // 重複を避けつつ追加
                    if (!parameterSets.has(setName)) {
                        parameterSets.set(setName, displayName);
                    }
                }
            }
        }
        
        // セレクトボックスにオプションを追加（アルファベット順にソート）
        const sortedSets = new Map([...parameterSets].sort((a, b) => a[1].localeCompare(b[1])));
        
        for (const [value, text] of sortedSets) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            parameterSetSelect.appendChild(option);
        }
        
        hideLoading();
    } catch (error) {
        console.error('パラメータセットの読み込み中にエラーが発生しました:', error);
        showError('パラメータセットの読み込みに失敗しました');
        hideLoading();
    } finally {
        hideLoading();
    }
}

/**
 * ローディング表示
 */
function showLoading() {
    const loadingElement = document.getElementById('chart-loading');
    if (loadingElement) {
        loadingElement.classList.remove('d-none');
    }
}

/**
 * ローディング非表示
 */
function hideLoading() {
    const loadingElement = document.getElementById('chart-loading');
    if (loadingElement) {
        loadingElement.classList.add('d-none');
    }
}

/**
 * エラーメッセージと「データなし」メッセージを非表示にする
 */
function hideError() {
    $('#chart-error').addClass('d-none');
    // $('#no-data-message').addClass('d-none');
}

// 対応する関数として、エラーを表示する関数も定義しておくと良いでしょう
function showError(message) {
    $('#chart-error').text(message || 'データを取得できませんでした。入力条件を確認してください。');
    $('#chart-error').removeClass('d-none');
}

function showNoDataMessage() {
    // $('#no-data-message').removeClass('d-none');
}

// DOMが読み込まれた後に実行
document.addEventListener('DOMContentLoaded', () => {
    // パラメータセットの読み込み
    loadParameterSets();
    
    // パラメータセット選択時の処理
    document.getElementById('filter-parameter-set').addEventListener('change', async function() {
        if (this.value) {
            const [exchange, symbol, strategy] = this.value.split(':');
            
            // 取引所と銘柄を自動選択
            const exchangeSelect = document.getElementById('selected-exchange');
            if (exchangeSelect) {
                exchangeSelect.innerHTML = exchange;
            }
            
            // 銘柄を設定
            const symbolSelect = document.getElementById('selected-symbol');
            if (symbolSelect) {
                symbolSelect.innerHTML = symbol;
            }

            // 戦略を設定
            const strategySelect = document.getElementById('selected-strategy');
            if (strategySelect) {
                strategySelect.innerHTML = strategy;
            }

            // パラメータセットの詳細を取得してtimeframeとlimitを判定
            await fetchParameterDetails(exchange, symbol, strategy);

            await fetchDataAndRenderChart()
        }
    });
});

// Chart.js v4 CDN環境で全ての標準コントローラ・エレメントを一括登録
if (window.Chart && Chart.registerables) {
    Chart.register(...Chart.registerables);
}
/**
 * パラメータからtimeframe（時間足）を抽出する関数
 */
function extractTimeframeFromParams(params) {
    // ohlcvInterval が存在する場合はそれを使用（大文字小文字を区別しない）
    for (const key in params) {
        if (key.toLowerCase() === 'ohlcvinterval') {
            return params[key];
        }
    }

    // デフォルト値
    return "1h";
}

/**
 * パラメータからlimit（表示数）を抽出する関数
 */
function extractLimitFromParams(params) {
    // periodという名前のパラメータがある場合（大文字小文字を区別しない）
    for (const key in params) {
        if (key.toLowerCase() === 'period' && !isNaN(params[key])) {
            return parseInt(params[key]);
        }
    }

    // periodを含むパラメータの最大値を探す（大文字小文字を区別しない）
    let maxPeriod = 0;

    for (const key in params) {
        if (key.toLowerCase().includes('period') && !isNaN(params[key])) {
            maxPeriod = Math.max(maxPeriod, parseInt(params[key]));
        }
    }

    if (maxPeriod > 0) {
        return maxPeriod;
    }

    // デフォルト値
    return 100;
}

/**
 * パラメータセットの詳細を取得してtimeframeとlimitを判定
 */
async function fetchParameterDetails(exchange, symbol, strategy) {
    try {
        const response = await fetch(`/api/parameters?exchangeId=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}&strategyKey=${encodeURIComponent(strategy)}`);

        if (!response.ok) {
            throw new Error('パラメータ詳細の取得に失敗しました');
        }

        const data = await response.json();
        const timeframe = extractTimeframeFromParams(data.params);
        const limit = extractLimitFromParams(data.params);

        document.getElementById('selected-timeframe').textContent = timeframe;
        document.getElementById('selected-limit').textContent = limit;
    } catch (error) {
        console.error('パラメータ詳細の取得に失敗しました:', error);
        document.getElementById('selected-timeframe').textContent = '取得失敗';
        document.getElementById('selected-limit').textContent = '取得失敗';
    }
}