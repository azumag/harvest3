/**
 * 分析ページのJavaScript
 * ロウソク足チャートと戦略シグナルを表示する
 */

// グローバル変数
let currentAnalysisParams = {}; // 現在表示中のパラメータ
let modifiedAnalysisParams = {}; // 変更されたパラメータ

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
 
// 新しいセレクトボックス要素への参照
let filterExchangeSelect;
let filterSymbolSelect;
let filterStrategySelect;
let filterTimeframeSelect;
let filterLimitSelect;

document.addEventListener('DOMContentLoaded', async function() {



    await loadParameterSets();

    // セレクトボックス要素への参照を取得
    filterExchangeSelect = document.getElementById('filter-exchange');
    filterSymbolSelect = document.getElementById('filter-symbol');
    filterStrategySelect = document.getElementById('filter-strategy');
    filterTimeframeSelect = document.getElementById('filter-timeframe');
    filterLimitSelect = document.getElementById('filter-limit');

    // Flatpickrの初期化 (日付選択)
    initializeDatepickers();

    // イベントリスナーの設定
    setupEventListeners();

    // 各セレクトボックスの初期データ読み込み
    await loadParameterSets(); // パラメータセットの読み込みは残す
    await fetchAndPopulateExchanges(); // 取引所リストの読み込み
    await populateStrategies(); // 戦略リストの読み込み
    // populateTimeframes(); // 時間足の静的設定
    // populateLimits(); // 表示数の静的設定

    // 取引所選択時の銘柄リスト更新イベントリスナーはsetupEventListeners内で設定
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

    // 戦略パラメータセットのドロップダウンにSelect2を適用 (イベントリスナー登録後に初期化)
    $('#filter-parameter-set').select2({
        theme: "bootstrap-5",
        placeholder: "検索または選択...",
        allowClear: true
    });

    // Select2の選択イベントリスナー
    $('#filter-parameter-set').on('select2:select', async function (e) {
        const selectedValue = $(this).val(); // または e.params.data.id
        if (selectedValue) {
            const [exchange, symbol, strategy] = selectedValue.split(':');

            // 個別のセレクトボックスに値を自動設定
            if (filterExchangeSelect) filterExchangeSelect.value = exchange;
            // 銘柄リストを更新して値を設定
            if (filterSymbolSelect) {
                 await fetchAndPopulateSymbols(exchange); // 銘柄リストを先に読み込む
                 filterSymbolSelect.value = symbol;
            }
            if (filterStrategySelect) filterStrategySelect.value = strategy;

            // パラメータセットの詳細を取得してtimeframeとlimitを判定し、セレクトボックスに設定
            await fetchParameterDetailsAndSetSelects(exchange, symbol, strategy);

            // 選択されたパラメータセットのパラメータを取得して表示
            await fetchAndDisplayParameters(exchange, symbol, strategy);

            await fetchDataAndRenderChart();
        }
    });

    // Select2の選択解除イベントリスナー (allowClear: true の場合)
    $('#filter-parameter-set').on('select2:unselect', async function (e) {
        // パラメータセットが選択されていない場合はパラメータ表示エリアをクリア
        document.getElementById('analysis-params-container').innerHTML = '<p class="text-muted small">パラメータセットを選択してください。</p>';
        document.getElementById('save-analysis-params-btn').disabled = true;
        currentAnalysisParams = {};
        modifiedAnalysisParams = {};
        // 必要に応じて他のフィルタやチャートをリセットする処理を追加
    });


    // 保存ボタンクリック時のイベント
    document.getElementById('save-analysis-params-btn').addEventListener('click', saveAnalysisParameters);

    // 取引所セレクトボックス変更時のイベント
    if (filterExchangeSelect) {
        filterExchangeSelect.addEventListener('change', async function() {
            await fetchAndPopulateSymbols(this.value);
            // 取引所が変わったら銘柄選択をリセット
            if (filterSymbolSelect) filterSymbolSelect.value = '';
        });
    }

    
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

    // 新しいセレクトボックスから値を取得
    const exchange = filterExchangeSelect ? filterExchangeSelect.value : '';
    const symbol = filterSymbolSelect ? filterSymbolSelect.value : '';
    const strategy = filterStrategySelect ? filterStrategySelect.value : '';
    const timeframe = filterTimeframeSelect ? filterTimeframeSelect.value : '1h'; // デフォルト値
    const limit = filterLimitSelect ? filterLimitSelect.value : '100'; // デフォルト値

    // 必須項目のチェック
    if (!exchange || !symbol || !strategy) {
        showError('取引所、銘柄、戦略を選択してください。');
        return;
    }

    // 日付はデフォルトで現在時刻を使用
    const startDate = document.getElementById('filter-start-date').value || formatDate(new Date());

    // ローディング表示
    // showLoading(true); // Re-enable loading display
    hideError();
/**
 * パラメータの入力フィールドを生成する
 */
function createInputField(key, value, type) {
    // TODO: 型に応じた入力フィールドのバリデーションや、select/checkboxなどの対応
    // 現状はtext入力のみ
    let inputType = 'text';
    let step = null;
    if (type === 'number') {
        inputType = 'number';
        step = 'any'; // 小数点も許可
    } else if (type === 'boolean') {
        // booleanの場合はチェックボックスやドロップダウンなどが考えられるが、
        // シンプルにtextで 'true'/'false' を入力させるか、別途対応が必要
        // ここでは一旦textとしておく
    }

    return `<input type="${inputType}" class="form-control form-control-sm parameter-input" data-param-key="${key}" value="${value}" ${step ? `step="${step}"` : ''}>`;
}

/**
 * パラメータをテーブル形式で表示する
 */
function displayAnalysisParameterTable(params, container) {
    if (!params || Object.keys(params).length === 0) {
        container.innerHTML = '<p class="text-muted">この戦略には設定可能なパラメータがありません。</p>';
        return;
    }

    const tableHtml = `
        <table class="table table-bordered table-striped table-hover">
            <thead>
                <tr>
                    <th>パラメータ名</th>
                    <th>値</th>
                    <th>型</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(params).map(([key, value]) => {
                    const type = typeof value;
                    return `
                        <tr>
                            <td>${key}</td>
                            <td>${createInputField(key, value, type)}</td>
                            <td>${type}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = tableHtml;

    // 入力フィールドの変更を監視
    container.querySelectorAll('input, select').forEach(input => {
        input.addEventListener('input', handleParameterInputChange);
        input.addEventListener('change', handleParameterInputChange); // select用
    });
}

/**
 * パラメータ入力フィールドの変更を処理する
 */
function handleParameterInputChange() {
    // 保存ボタンを有効化
    document.getElementById('save-analysis-params').disabled = false;
}

/**
 * パラメータを保存する
 */
async function saveAnalysisParameters() {
    if (!currentParameterSet) {
        console.warn('保存するパラメータセットが選択されていません。');
        return;
    }

    const updatedParams = {};
    let isValid = true;

    // フォームから現在の値を取得
    document.querySelectorAll('#parameter-settings-container .parameter-input').forEach(input => {
        const key = input.dataset.paramKey;
        let value = input.value;
        const type = currentParameterSet.params && currentParameterSet.params.hasOwnProperty(key) ? typeof currentParameterSet.params[key] : 'string'; // 元の型を取得

        // 型に応じた変換とバリデーション（簡易的）
        if (type === 'number') {
            const numValue = parseFloat(value);
            if (isNaN(numValue)) {
                isValid = false;
                showError(`パラメータ "${key}" の値が無効です。数値を入力してください。`);
                return; // forEachから抜ける
            }
            value = numValue;
        } else if (type === 'boolean') {
             // booleanの簡易的な処理
             if (value.toLowerCase() === 'true') {
                 value = true;
             } else if (value.toLowerCase() === 'false') {
                 value = false;
             } else {
                 isValid = false;
                 showError(`パラメータ "${key}" の値が無効です。"true" または "false" を入力してください。`);
                 return; // forEachから抜ける
             }
        }
        // TODO: 他の型（例: 配列、オブジェクト）の対応

        updatedParams[key] = value;
    });

    if (!isValid) {
        // バリデーションエラーがあれば保存しない
        return;
    }

    // 保存ボタンを無効化し、ローディング表示
    document.getElementById('save-analysis-params').disabled = true;
    showLoading();

    try {
        const response = await fetch('/api/parameters', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                exchangeId: currentParameterSet.exchangeId,
                symbol: currentParameterSet.symbol,
                strategyKey: currentParameterSet.strategyKey,
                params: updatedParams
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `パラメータの保存に失敗しました (HTTP ${response.status})`);
        }

        // 保存成功のフィードバック
        showFeedback('パラメータが正常に保存されました。', 'success');

    } catch (error) {
        console.error('パラメータの保存に失敗しました:', error);
        showFeedback(`パラメータの保存に失敗しました: ${error.message}`, 'danger');
        // エラー時は保存ボタンを再度有効化
        document.getElementById('save-analysis-params').disabled = false;
    } finally {
        hideLoading(); // ローディング非表示
    }
}

/**
 * フィードバックの表示 (簡易版)
 */
function showFeedback(message, type = "success") {
    const feedbackElement = document.getElementById('parameter-feedback'); // analysis.htmlにフィードバック表示エリアを追加する必要があるかもしれません
    if (feedbackElement) {
        feedbackElement.textContent = message;
        feedbackElement.className = `alert alert-${type === 'success' ? 'success' : 'danger'}`;
        feedbackElement.classList.remove('d-none');
        // 3秒後に非表示
        setTimeout(() => {
            feedbackElement.classList.add('d-none');
        }, 3000);
    } else {
        // フィードバックエリアがない場合はアラートで代用
        alert(`${type.toUpperCase()}: ${message}`);
    }
}

    try {
        // ロウソク足データの取得
        const ohlcvData = await fetchOhlcvData(exchange, symbol, timeframe, limit, startDate);

        // 戦略シグナルデータの取得
        let signalData = [];
        if (strategy) {
            signalData = await fetchStrategySignals(exchange, symbol, strategy, startDate, ohlcvData);
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
        showLoading();

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
async function fetchStrategySignals(exchange, symbol, strategy, startDate, ohlcData) {
    try {
        // APIリクエストパラメータの構築
        const params = new URLSearchParams({
            exchange,
            symbol,
            strategy
        });
        
        if (ohlcData) {
            // ロウソク足データから期間を取得
            const startTimestamp = ohlcData[0][0];
            const endTimestamp = ohlcData[ohlcData.length - 1][0];
            params.append('startDate', new Date(startTimestamp));
            params.append('endDate', new Date(endTimestamp));
        } else if(startDate) {
            params.append('endDate', startDate);
        } else {
            params.append('endDate', new Date().getTime());
        }
        
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
    addBollingerToChart(chart, ohlcvData);
    console.log('renderChart - ohlcDataset type:', ohlcDataset.type);
}

function addBollingerToChart(chart, ohlcvData) {

    const paramKey = `params:${filterExchangeSelect.value}:${filterSymbolSelect.value}:${filterStrategySelect.value}`;
    const params = currentAnalysisParams[paramKey] || {};
    const period = Number(params.period) || 20;
    const stdDev = Number(params.stdDev) || 2;

    // 終値の配列を作成
    const closes = ohlcvData.map(candle => candle[4]);
    // console.log(closes.length); // デバッグ用

    // ボリンジャーバンド計算
    const rawBands = calculateBollingerBands(closes, period, stdDev);

    // タイムスタンプとバンド値を組み合わせたデータを作成
    // null 値はそのまま保持する
    const upperBandData = ohlcvData.map((candle, index) => ({
        x: candle[0], // タイムスタンプ
        y: rawBands.upper[index] // 対応するバンド値 (null の可能性あり)
    }));
    const middleBandData = ohlcvData.map((candle, index) => ({
        x: candle[0],
        y: rawBands.middle[index]
    }));
    const lowerBandData = ohlcvData.map((candle, index) => ({
        x: candle[0],
        y: rawBands.lower[index]
    }));

    // console.log('Bollinger Bands Data:', { upper: upperBandData, middle: middleBandData, lower: lowerBandData }); // デバッグ用

    // 既存のボリンジャーバンドデータセットを削除（更新の場合）
    chart.data.datasets = chart.data.datasets.filter(dataset =>
        !dataset.label?.startsWith('ボリンジャーバンド')
    );

    // 新しいデータセットを追加 (type: 'line' と spanGaps: true を追加)
    chart.data.datasets.push({
        label: 'ボリンジャーバンド上限',
        data: upperBandData,
        borderColor: 'rgba(75, 192, 192, 0.8)',
        borderWidth: 1,
        fill: false,
        type: 'line', // 線グラフとして明示
        pointRadius: 0, // 点は表示しない
        tension: 0.1, // 少し滑らかに
        spanGaps: true // null値を線でつなぐ
    });
    // 中央線も追加
    chart.data.datasets.push({
        label: 'ボリンジャーバンド中央',
        data: middleBandData,
        borderColor: 'rgba(255, 159, 64, 0.8)',
        borderWidth: 1,
        borderDash: [5, 5], // 破線
        fill: false,
        type: 'line',
        pointRadius: 0,
        tension: 0.1,
        spanGaps: true
    });
    chart.data.datasets.push({
        label: 'ボリンジャーバンド下限',
        data: lowerBandData,
        borderColor: 'rgba(255, 99, 132, 0.8)',
        borderWidth: 1,
        fill: false,
        type: 'line',
        pointRadius: 0,
        tension: 0.1,
        spanGaps: true
    });

    // データを追加した後にチャートを更新
    chart.update();

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
            backgroundColor: isBuy ? 'rgb(42, 167, 40)' : 'rgb(220, 53, 53)',
            borderColor: 'white',
            borderWidth: 2,
            radius: 10,
            pointStyle: isBuy ? 'triangle' : 'triangle',
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
        pointRadius: 0,
        showLine: false
    } : null;
    const sellDataset = sellSignals.length > 0 ? {
        label: 'Sellシグナル',
        type: 'scatter',
        data: sellSignals.map(s => ({ x: s.timestamp, y: s.price })),
        backgroundColor: 'red',
        pointRadius: 0,
        showLine: false
    } : null;
    return [buyDataset, sellDataset].filter(Boolean);
}

/**
 * パラメータセットを読み込み、セレクトボックスに表示する
 */
async function loadParameterSets() {
    try {
        
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
        
    } catch (error) {
        console.error('パラメータセットの読み込み中にエラーが発生しました:', error);
        showError('パラメータセットの読み込みに失敗しました');
    } finally {
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
    // エラー表示時はフィードバックも表示
    showFeedback(message, 'danger');
}

/**
 * フィードバックの表示
 * @param {string} message - 表示するメッセージ
 * @param {string} type - アラートタイプ（success, danger, warning, info）
 */
function showFeedback(message, type = "success") {
    console.log("Showing feedback:", message, type);

    // Bootstrapのアラートクラス名に変換
    const alertClass = type === "success" ? "alert-success" :
                       (type === "danger" ? "alert-danger" :
                       (type === "warning" ? "alert-warning" : "alert-info"));

    // フィードバックを表示する要素（今回は #chart-error を再利用）
    const feedbackElement = document.getElementById("chart-error");
    if (!feedbackElement) {
        console.error("フィードバック表示要素が見つかりません");
        return;
    }

    // 既存のクラスをクリアし、新しいクラスとメッセージを設定
    feedbackElement.className = `alert ${alertClass} mt-3`; // d-none は削除
    feedbackElement.innerHTML = message; // HTMLとしてメッセージを設定

    // スクロールして表示範囲内に
    feedbackElement.scrollIntoView({ behavior: "smooth", block: "center" });

    // 自動的に消える処理 (任意)
    // setTimeout(function() {
    //     feedbackElement.classList.add('d-none');
    // }, 5000); // 5秒後に非表示
}

function showNoDataMessage() {
    // $('#no-data-message').removeClass('d-none');
}

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
    return "15m";
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

        if (filterTimeframeSelect) filterTimeframeSelect.value = timeframe;
        if (filterLimitSelect) filterLimitSelect.value = limit;

    } catch (error) {
        console.error('パラメータ詳細の取得に失敗しました:', error);
        // エラー時はセレクトボックスの値をデフォルトに戻すか、エラー表示を検討
        if (filterTimeframeSelect) filterTimeframeSelect.value = '1h';
        if (filterLimitSelect) filterLimitSelect.value = '100';
    }
}

/**
 * 時間足セレクトボックスにオプションを静的に設定
 */
function populateTimeframes() {
    const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '8h', '12h', '1d', '1w'];
    if (filterTimeframeSelect) {
        filterTimeframeSelect.innerHTML = ''; // 既存オプションをクリア
        timeframes.forEach(tf => {
            const option = document.createElement('option');
            option.value = tf;
            option.textContent = tf;
            if (tf === '15m') { // デフォルト値を設定
                option.selected = true;
            }
            filterTimeframeSelect.appendChild(option);
        });
    }
}

/**
 * パラメータセットの詳細を取得してtimeframeとlimitを判定し、セレクトボックスに設定
 */
async function fetchParameterDetailsAndSetSelects(exchange, symbol, strategy) {
    try {
        const response = await fetch(`/api/parameters?exchangeId=${encodeURIComponent(exchange)}&symbol=${encodeURIComponent(symbol)}&strategyKey=${encodeURIComponent(strategy)}`);

        if (!response.ok) {
            throw new Error('パラメータ詳細の取得に失敗しました');
        }

        const data = await response.json();
        const timeframe = extractTimeframeFromParams(data.params);
        // const limit = extractLimitFromParams(data.params);

        if (filterTimeframeSelect) filterTimeframeSelect.value = timeframe;
        // if (filterLimitSelect) filterLimitSelect.value = limit;

    } catch (error) {
        console.error('パラメータ詳細の取得に失敗しました:', error);
        // エラー時はセレクトボックスの値をデフォルトに戻すか、エラー表示を検討
        if (filterTimeframeSelect) filterTimeframeSelect.value = '15m';
        if (filterLimitSelect) filterLimitSelect.value = '100';
    }
}

/**
 * パラメータセットの詳細を取得し、パラメータ表示エリアに表示する
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 銘柄
 * @param {string} strategyKey - 戦略キー
 */
async function fetchAndDisplayParameters(exchangeId, symbol, strategyKey) {
    const containerElement = document.getElementById('analysis-params-container');
    if (!containerElement) {
        console.error('パラメータ表示コンテナが見つかりません');
        return;
    }

    containerElement.innerHTML = '<p class="text-muted">パラメータを取得中...</p>';
    document.getElementById('save-analysis-params-btn').disabled = true;
    currentAnalysisParams = {}; // 表示前にクリア
    modifiedAnalysisParams = {}; // 表示前にクリア

    try {
        const response = await fetch(`/api/parameters?exchangeId=${encodeURIComponent(exchangeId)}&symbol=${encodeURIComponent(symbol)}&strategyKey=${encodeURIComponent(strategyKey)}`);

        if (!response.ok) {
            throw new Error('パラメータ詳細の取得に失敗しました');
        }

        const data = await response.json();
        const params = data.params || {}; // paramsが存在しない場合を考慮

        // グローバル変数に現在のパラメータを保存
        const paramKey = `params:${exchangeId}:${symbol}:${strategyKey}`;
        currentAnalysisParams[paramKey] = { ...params };

        // パラメータを表示
        displayParameterTable(exchangeId, symbol, strategyKey, params, containerElement);

        // パラメータが1つ以上あれば保存ボタンを有効化
        if (Object.keys(params).length > 0) {
             // 保存ボタンはパラメータ変更時に有効化するため、ここでは無効のまま
             document.getElementById('save-analysis-params-btn').disabled = true;
        } else {
             document.getElementById('save-analysis-params-btn').disabled = true;
        }


    } catch (error) {
        console.error('パラメータ詳細の取得と表示に失敗しました:', error);
        containerElement.innerHTML = '<p class="text-danger">パラメータの取得に失敗しました。</p>';
        document.getElementById('save-analysis-params-btn').disabled = true;
    }
}

/**
 * 分析ページのパラメータ表示エリアに単一のパラメータセットのテーブルを表示する
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 銘柄
 * @param {string} strategyKey - 戦略キー
 * @param {Object} params - パラメータオブジェクト
 * @param {HTMLElement} containerElement - 表示先のコンテナ要素
 */
/**
 * 入力フィールドのHTMLを生成
 * @param {string} paramName - パラメータ名
 * @param {any} paramValue - パラメータ値
 * @param {string} paramKey - パラメータキー（params:exchange:symbol:strategy）
 * @returns {string} HTML文字列
 */
function createInputField(paramName, paramValue, paramKey) {
  const type = typeof paramValue;
  const inputId = `${paramKey}-${paramName}`.replace(/[^a-zA-Z0-9-]/g, '_'); // IDとして有効な文字のみ使用
  let inputHtml = '';

  // data-param-key と data-param-name を追加
  const dataAttributes = `data-param-key="${paramKey}" data-param-name="${paramName}"`;

  // すべてのinputに適用する共通スタイル (border-box, width 100%, no border/margin/padding)
  const commonStyles = "box-sizing: border-box; width: 100%; border: none; margin: 0; padding: 0.1rem 0.25rem; height: 100%; min-height: 1.8em;";

  if (type === 'boolean') {
    // 真偽値の場合はチェックボックス
    inputHtml = `
      <div class="d-flex justify-content-center align-items-center h-100">
        <input type="checkbox" class="form-check-input m-auto" id="${inputId}"
               ${paramValue ? 'checked' : ''} ${dataAttributes}>
      </div>
    `;
  } else if (type === 'number') {
    // 数値の場合は数値入力フィールド
    inputHtml = `
      <input type="number" class="form-control-plaintext form-control-sm" id="${inputId}"
             value="${paramValue}" step="any" style="${commonStyles}" ${dataAttributes}>
    `;
  } else if (type === 'object' && paramValue !== null) {
    // オブジェクトまたは配列の場合はJSON表示 (TextArea)
    const jsonValue = JSON.stringify(paramValue, null, 2);
    inputHtml = `
      <textarea class="form-control-plaintext form-control-sm" id="${inputId}"
               rows="1" style="${commonStyles} font-size: 0.8em; resize: none; overflow: auto;" ${dataAttributes}>${jsonValue}</textarea>
    `;
  } else {
    // その他（文字列など）はテキスト入力フィールド
    inputHtml = `
      <input type="text" class="form-control-plaintext form-control-sm" id="${inputId}"
             value="${paramValue !== null ? paramValue : ''}" style="${commonStyles}" ${dataAttributes}>
    `;
  }

  return inputHtml;
}

/**
 * パラメータのテーブルを表示する (analysis.js 用に調整)
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 銘柄
 * @param {string} strategyKey - 戦略キー
 * @param {Object} params - パラメータオブジェクト
 * @param {HTMLElement} containerElement - 表示先のコンテナ要素
 */
function displayParameterTable(exchangeId, symbol, strategyKey, params, containerElement) {
    const formId = `analysis-form-${exchangeId}-${symbol.replace(/[^a-zA-Z0-9]/g, '-')}-${strategyKey.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const paramKey = `params:${exchangeId}:${symbol}:${strategyKey}`;

    // パラメータ名をソート
    const sortedParamNames = Object.keys(params).sort();
    const paramCount = sortedParamNames.length;

    if (paramCount === 0) {
        containerElement.innerHTML = '<p class="text-muted">このパラメータセットには設定可能なパラメータがありません。</p>';
        document.getElementById('save-analysis-params-btn').disabled = true;
        return;
    }

    // テーブルHTMLを生成
    let tableHtml = `
        <form id="${formId}">
            <div class="table-responsive">
                <table class="table table-sm table-bordered table-hover" style="width: 100%;">
                    <thead class="table-light">
                        <tr>
                            <th style="width: 30%;">パラメータ名</th>
                            <th>値</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    // 各パラメータの入力フィールドを生成
    sortedParamNames.forEach(paramName => {
        const paramValue = params[paramName];
        tableHtml += `<tr>`;
        tableHtml += `<td class="align-middle" style="width: 30%;">${paramName}</td>`;
        tableHtml += `<td class="p-0 align-middle">`; // パディングを削除
        tableHtml += createInputField(paramName, paramValue, paramKey); // createInputFieldを呼び出し
        tableHtml += `</td>`;
        tableHtml += `</tr>`;
    });

    tableHtml += `
                    </tbody>
                </table>
            </div>
        </form>
    `;

    containerElement.innerHTML = tableHtml;

    // ツールチップを有効化 (Bootstrapの機能)
    const tooltipTriggerList = containerElement.querySelectorAll('[data-bs-toggle="tooltip"]');
    tooltipTriggerList.forEach(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));

    // パラメータ変更時のイベントリスナーを設定 (イベント委譲)
    const formElement = document.getElementById(formId);
    if (formElement) {
        formElement.addEventListener('change', handleParameterInputChange);
    }
}

/**
 * パラメータ入力フィールドの変更を処理するイベントリスナー
 * @param {Event} e - changeイベントオブジェクト
 */
function handleParameterInputChange(e) {
    const input = e.target;
    // data-param-key と data-param-name を持つ要素のみを対象とする
    if (!input.matches('[data-param-key][data-param-name]')) return;

    const paramKey = input.getAttribute('data-param-key');
    const paramName = input.getAttribute('data-param-name');

    // 変更されたパラメータを追跡
    if (!modifiedAnalysisParams[paramKey]) {
        modifiedAnalysisParams[paramKey] = {};
    }

    // 入力値を適切な型に変換
    let value = input.value;
    if (input.type === 'number') {
        value = parseFloat(value);
    } else if (input.type === 'checkbox') {
        value = input.checked;
    } else if (input.tagName === 'TEXTAREA') {
       try {
        value = JSON.parse(value);
       } catch (err) {
        // JSONパースに失敗した場合は文字列として扱う
        console.warn(`JSON parse error for ${paramKey} - ${paramName}: ${err.message}. Treating as string.`);
       }
    }

    modifiedAnalysisParams[paramKey][paramName] = value;

    // 保存ボタンを有効化
    document.getElementById('save-analysis-params-btn').disabled = false;
}

/**
 * パラメータを保存する
 */
async function saveAnalysisParameters() {
    if (Object.keys(modifiedAnalysisParams).length === 0) {
        showFeedback('変更されたパラメータがありません。', 'warning');
        return;
    }

    try {
        showLoading();

        let successCount = 0;
        let errorCount = 0;
        const errorDetails = [];
        const updatedParamKeys = new Set(); // 更新されたキーを追跡

        // 変更された各パラメータセットを保存
        for (const [paramKey, changedValues] of Object.entries(modifiedAnalysisParams)) {
            const [prefix, exchangeId, symbol, strategyKey] = paramKey.split(':');
            if (prefix !== 'params') continue; // キー形式チェック

            // 現在のパラメータと変更された値をマージ
            // currentAnalysisParams[paramKey] が存在しない場合も考慮 (念のため)
            const baseParams = currentAnalysisParams[paramKey] || {};
            const mergedParams = { ...baseParams, ...changedValues };

            try {
                const response = await fetch('/api/parameters', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        exchangeId,
                        symbol,
                        strategyKey,
                        params: mergedParams
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `パラメータの保存に失敗しました (HTTP ${response.status})`);
                }

                // 保存成功時は現在のパラメータを更新
                currentAnalysisParams[paramKey] = { ...mergedParams };
                updatedParamKeys.add(paramKey); // 更新されたキーを追加
                successCount++;
            } catch (error) {
                console.error(`${paramKey} のパラメータ保存中にエラーが発生:`, error);
                errorCount++;
                errorDetails.push(`${exchangeId}:${symbol}:${strategyKey} - ${error.message}`);
            }
        }

        // modifiedAnalysisParamsから正常に更新されたキーを削除
        updatedParamKeys.forEach(key => {
            delete modifiedAnalysisParams[key];
        });

        // 保存結果のフィードバック
        let message = '';
        let type = 'info';

        if (errorCount === 0) {
            message = `${successCount} 件のパラメータセットが正常に保存されました。`;
            type = 'success';
            // 変更追跡をリセット (エラーがなければ空のはず)
            modifiedAnalysisParams = {};
            // 保存ボタンを無効化
            document.getElementById('save-analysis-params-btn').disabled = true;
        } else if (successCount > 0) {
            message = `${successCount} 件のパラメータセットが保存されましたが、${errorCount} 件でエラーが発生しました。<br>${errorDetails.join('<br>')}`;
            type = 'warning';
             // エラーが残っている場合は保存ボタンを有効のままにする
             document.getElementById('save-analysis-params-btn').disabled = false;
        } else {
            message = `すべてのパラメータ (${errorCount}件) の保存に失敗しました。<br>${errorDetails.join('<br>')}`;
            type = 'danger';
             // エラーが残っている場合は保存ボタンを有効のままにする
             document.getElementById('save-analysis-params-btn').disabled = false;
        }
        showFeedback(message, type);

        hideLoading();
    } catch (error) {
        console.error('パラメータの保存処理全体でエラーが発生しました:', error);
        showFeedback('エラー: パラメータの保存処理中に予期せぬエラーが発生しました。', 'danger');
        hideLoading();
         // 予期せぬエラーの場合もボタンは有効のままにする
         document.getElementById('save-analysis-params-btn').disabled = false;
    }
}

// 以下は便宜上 /src/strategies/indicator.js からペースト
// TODO: API化して呼び出す
/**
 * テクニカル指標を計算するためのユーティリティ関数
 */

/**
 * 単純移動平均（SMA）を計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} period - 期間
 * @returns {Array} - SMAの配列
 */
function calculateSMA(prices, period) {
  const result = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += prices[i - j];
    }
    
    result.push(sum / period);
  }
  
  return result;
}

/**
 * 指数移動平均（EMA）を計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} period - 期間
 * @returns {Array} - EMAの配列
 */
function calculateEMA(prices, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  
  // 最初のEMAはSMAとして計算
  let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    
    if (i === period - 1) {
      result.push(ema);
      continue;
    }
    
    // EMA = 前日のEMA + α × (今日の価格 - 前日のEMA)
    ema = (prices[i] - ema) * multiplier + ema;
    result.push(ema);
  }
  
  return result;
}

/**
 * MACDを計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} fastPeriod - 短期EMAの期間（デフォルト12）
 * @param {Number} slowPeriod - 長期EMAの期間（デフォルト26）
 * @param {Number} signalPeriod - シグナルラインの期間（デフォルト9）
 * @returns {Object} - MACD、シグナル、ヒストグラムの配列
 */
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);
  const macdLine = [];
  
  // MACD = 短期EMA - 長期EMA
  for (let i = 0; i < prices.length; i++) {
    if (i < slowPeriod - 1) {
      macdLine.push(null);
      continue;
    }
    
    macdLine.push(fastEMA[i] - slowEMA[i]);
  }
  
  // シグナルラインはMACDのEMA
  const signalLine = calculateEMA(
    macdLine.filter(value => value !== null),
    signalPeriod
  );
  
  // シグナルラインの長さをMACDラインに合わせる
  const paddedSignalLine = Array(slowPeriod + signalPeriod - 2).fill(null).concat(signalLine);
  
  // ヒストグラム = MACD - シグナル
  const histogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null || paddedSignalLine[i] === null) {
      histogram.push(null);
    } else {
      histogram.push(macdLine[i] - paddedSignalLine[i]);
    }
  }
  
  return {
    macd: macdLine,
    signal: paddedSignalLine,
    histogram: histogram
  };
}

/**
 * RSI（相対力指数）を計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} period - 期間（デフォルト14）
 * @returns {Array} - RSIの配列
 */
function calculateRSI(prices, period) {
  // console.log(`calculateRSI called with prices.length: ${prices ? prices.length : 'null'}, period: ${period}`);
  
  // 最低限、period分のデータがあれば計算可能に修正（+1の条件を削除）
  if (!prices || prices.length < period) {
    // console.log('calculateRSI: Not enough data');
    return [];
  }
  
  try {
    const result = [];
    const gains = [];
    const losses = [];
    
    // 価格変動を計算
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    
    // 最初のperiod日分はnullを追加
    for (let i = 0; i < period; i++) {
      result.push(null);
    }
    
    // 初回のRSI計算（period日目）
    let avgGain = 0;
    let avgLoss = 0;
    
    // 最初のperiod日間の平均を計算
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    // console.log(`calculateRSI: Initial avgGain: ${avgGain}, avgLoss: ${avgLoss}`);

    // 初回のRSIを計算して追加
    const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const firstRsi = 100 - (100 / (1 + firstRs));
    // console.log(`calculateRSI: First RSI calculated: ${firstRsi}, avgGain: ${avgGain}, avgLoss: ${avgLoss}. result length before push: ${result.length}`);
    result.push({
      rsi: firstRsi,
      avgGain: avgGain,
      avgLoss: avgLoss
    });
    
    // 残りの日数分のRSIを計算
    for (let i = period + 1; i < prices.length; i++) {
      // console.log(`calculateRSI: Smoothing loop i: ${i}`);
      // スムージング計算（現在処理中のインデックスに対応する値）
      const currentGain = gains[i - 1];
      const currentLoss = losses[i - 1];
      
      // 前のインデックスの結果が存在することを確認
      const prevIndex = result.length - 1;
      if (prevIndex < 0 || !result[prevIndex]) {
        // console.log(`calculateRSI: Skipping calculation at i=${i} because previous result is not available.`);
        continue;
      }
      
      // console.log(`calculateRSI: Smoothing calculation at i=${i}, prevIndex=${prevIndex}. result[prevIndex]: ${JSON.stringify(result[prevIndex])}, currentGain: ${currentGain}, currentLoss: ${currentLoss}`);

      avgGain = (result[prevIndex].avgGain * (period - 1) + currentGain) / period;
      avgLoss = (result[prevIndex].avgLoss * (period - 1) + currentLoss) / period;
      
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      
      result.push({
        rsi: rsi,
        avgGain: avgGain,
        avgLoss: avgLoss
      });
    }
    
    // RSI値のみの配列を返す
    // console.log(`calculateRSI: Final result length: ${result.length}`);
    return result.map(item => item === null ? null : item.rsi);
  } catch (error) {
    // console.error('RSI計算エラー:', error);
    return [];  // エラー時は空の配列を返す
  }
}

/**
 * ボリンジャーバンドを計算
 * @param {Array} prices - 価格データの配列
 * @param {Number} period - 期間（デフォルト20）
 * @param {Number} multiplier - 標準偏差の乗数（デフォルト2）
 * @returns {Object} - 上限、中央、下限の配列
 */
function calculateBollingerBands(prices, period = 20, multiplier = 2) {
  const middle = calculateSMA(prices, period);
  const upper = [];
  const lower = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    
    // 標準偏差を計算
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += Math.pow(prices[i - j] - middle[i], 2);
    }
    const stdDev = Math.sqrt(sum / period);
    
    // 上限と下限を計算
    upper.push(middle[i] + (multiplier * stdDev));
    lower.push(middle[i] - (multiplier * stdDev));
  }
  
  return {
    upper: upper,
    middle: middle,
    lower: lower
  };
}