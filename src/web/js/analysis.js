/**
 * 分析画面の機能を制御するスクリプト
 */

// グローバル変数
let currentPeriod = 'daily';
let currentInterval = '15m';
let currentTimeRange = 'last_100';
let customStartDate = null;
let customEndDate = null;
let charts = {
  timeSeriesChart: null,
  strategyPerformanceChart: null,
  exchangePerformanceChart: null,
  hourlyVolumeChart: null,
  tradeSizeDistributionChart: null
};

// 色設定
const chartColors = {
  buy: 'rgba(40, 167, 69, 0.7)',
  sell: 'rgba(220, 53, 69, 0.7)',
  profit: 'rgba(0, 123, 255, 0.7)',
  exchanges: [
    'rgba(75, 192, 192, 0.7)',
    'rgba(153, 102, 255, 0.7)',
    'rgba(255, 159, 64, 0.7)',
    'rgba(255, 99, 132, 0.7)',
    'rgba(54, 162, 235, 0.7)'
  ],
  strategies: [
    'rgba(255, 99, 132, 0.7)',
    'rgba(54, 162, 235, 0.7)',
    'rgba(255, 206, 86, 0.7)',
    'rgba(75, 192, 192, 0.7)',
    'rgba(153, 102, 255, 0.7)'
  ]
};

// --- 取引所・銘柄選択とローソク足チャート ---
let ohlcChart = null;

/**
 * OHLCVデータを取得する関数を修正 - 時間範囲を適用
 */
async function loadOhlcvData() {
  const exchange = document.getElementById('exchange-select').value;
  const symbol = document.getElementById('symbol-select').value;
  const interval = currentInterval; // グローバル変数から時間足を取得
  
  if (!exchange || !symbol) return;
  
  try {
    // 基本パラメータを設定
    const params = new URLSearchParams({ 
      exchange, 
      symbol, 
      interval 
    });
    
    // 選択された時間範囲に基づいてパラメータを追加
    const timeParams = getTimeRangeParams();
    if (timeParams.limit) {
      params.append('limit', timeParams.limit);
    }
    if (timeParams.since) {
      params.append('since', timeParams.since);
    }
    if (timeParams.until) {
      params.append('until', timeParams.until);
    }
    
    console.log('OHLCV取得パラメータ:', Object.fromEntries(params));
    const res = await fetch(`/api/ohlcv?${params.toString()}`);
    const data = await res.json();
    
    if (!data || data.length === 0) {
      updateOhlcChart([]);
      return;
    }
    
    // Chart.js Financial形式に変換
    const ohlcvData = data.map(item => ({
      x: item[0], o: item[1], h: item[2], l: item[3], c: item[4]
    }));
    
    updateOhlcChart(ohlcvData);
  } catch (e) {
    updateOhlcChart([]);
    console.log(e);
  }
}

/**
 * 現在選択されている時間範囲に応じたパラメータを取得
 */
function getTimeRangeParams() {
  const now = Date.now();
  const params = {};
  
  switch (currentTimeRange) {
    case 'last_100':
      params.limit = 100;
      break;
    case 'last_24h':
      params.since = now - 24 * 60 * 60 * 1000;
      params.until = now;
      break;
    case 'last_7d':
      params.since = now - 7 * 24 * 60 * 60 * 1000;
      params.until = now;
      break;
    case 'last_30d':
      params.since = now - 30 * 24 * 60 * 60 * 1000;
      params.until = now;
      break;
    case 'custom':
      if (customStartDate) params.since = customStartDate;
      if (customEndDate) params.until = customEndDate;
      break;
  }
  
  return params;
}

/**
 * 戦略シグナル取得関数を修正 - 時間範囲を考慮する
 */
async function loadStrategySignals() {
  const exchange = document.getElementById('exchange-select').value;
  const symbol = document.getElementById('symbol-select').value;
  const strategy = document.getElementById('strategy-select').value;
  
  if (!exchange || !symbol) return [];
  if (!strategy) return []; // 戦略が選択されていない場合は表示しない
  
  // ローソク足チャートのデータ範囲を取得
  // 前の実装ではチャートに表示されているデータ範囲を使用していましたが、
  // 今回は選択された時間範囲を使用します
  const timeParams = getTimeRangeParams();
  
  try {
    const params = new URLSearchParams({
      exchange,
      symbol,
      strategy
    });
    
    // 時間範囲を設定
    if (timeParams.since) {
      params.append('start_time', timeParams.since);
    }
    if (timeParams.until) {
      params.append('end_time', timeParams.until);
    }
    
    console.log('戦略シグナル取得パラメータ:', Object.fromEntries(params));
    const res = await fetch(`/api/strategy-signals?${params.toString()}`);
    const result = await res.json();
    
    console.log('取得した戦略シグナル:', result);
    return result.data || [];
  } catch (e) {
    console.error('戦略シグナル履歴の取得に失敗しました:', e);
    return [];
  }
}

/**
 * チャートの時間範囲を取得する関数
 */
function getChartTimeRange() {
  if (!window.ohlcChart || !window.ohlcChart.data.datasets[0].data.length) {
    return null;
  }
  
  const ohlcData = window.ohlcChart.data.datasets[0].data;
  const start = Math.min(...ohlcData.map(d => d.x));
  const end = Math.max(...ohlcData.map(d => d.x));
  
  return { start, end };
}

/**
 * ローソク足チャートに戦略シグナルを表示する関数
 * @param {Array} signalData - シグナルデータ
 */
function addSignalsToChart(signalData) {
  if (!window.ohlcChart || !signalData || signalData.length === 0) return;
  
  console.log('チャートに表示するシグナル数:', signalData.length);
  
  try {
    // アノテーションのプラグイン設定を確認
    if (!window.ohlcChart.options.plugins.annotation) {
      console.log('アノテーションプラグイン設定を初期化します');
      window.ohlcChart.options.plugins.annotation = {
        annotations: {}
      };
    }
    
    // 新しいアノテーションを追加
    const annotations = {};
    
    signalData.forEach((signal, index) => {
      const id = `signal-${index}`;
      annotations[id] = createSignalAnnotation(signal);
    });
    
    console.log('追加するアノテーション:', annotations);
    window.ohlcChart.options.plugins.annotation.annotations = annotations;
    
    // 明示的にチャートを更新（アニメーションなし）
    window.ohlcChart.update('none');
    console.log('チャートを更新しました');
  } catch (error) {
    console.error('シグナルの表示中にエラーが発生しました:', error);
  }
}

/**
 * シグナルデータからアノテーションオブジェクトを作成する
 * @param {Object} signal - シグナルデータ
 * @returns {Object} - Chart.jsアノテーションオブジェクト
 */
function createSignalAnnotation(signal) {
  // シグナルタイプに基づいてデザインを決定
  const isBuy = signal.signalType === 'buy';
  const color = isBuy ? 'rgba(40, 167, 69, 1)' : 'rgba(220, 53, 69, 1)';
  const pointStyle = isBuy ? 'triangle' : 'triangle-down';
  
  // プライスポイントを取得（ローソク足の上または下に配置）
  const yAdjust = isBuy ? 10 : -10; // 買いは上に、売りは下に表示
  
  return {
    type: 'point',
    xValue: signal.timestamp,
    yValue: signal.price,
    backgroundColor: color,
    borderColor: 'white',
    borderWidth: 2,
    radius: 8,
    pointStyle: pointStyle,
    yAdjust: yAdjust,
    
    // ツールチップの設定
    tooltip: {
      enabled: true,
      callbacks: {
        title: function() {
          return `${isBuy ? '買い' : '売り'}シグナル`;
        },
        label: function() {
          const date = new Date(signal.timestamp).toLocaleString('ja-JP');
          return [
            `時間: ${date}`,
            `価格: ${signal.price}`,
            `戦略: ${signal.strategyKey}`
          ];
        }
      }
    }
  };
}

async function loadExchangeOptions() {
  const select = document.getElementById('exchange-select');
  select.innerHTML = '';
  try {
    const res = await fetch('/api/exchanges');
    const exchanges = await res.json();
    exchanges.forEach(ex => {
      const opt = document.createElement('option');
      opt.value = ex;
      opt.textContent = ex;
      select.appendChild(opt);
    });
    if (exchanges.length > 0) {
      select.value = exchanges[0];
      await loadSymbolOptions();
    }
  } catch (e) {
    select.innerHTML = '<option>取得失敗</option>';
  }
}

// ローソク足チャートの初期化前にプラグインを登録
function registerChartPlugins() {
  if (typeof Chart === 'undefined') return false;
  
  // Annotationプラグインの登録を確認（様々な名前を確認）
  if (typeof ChartAnnotation !== 'undefined') {
    Chart.register(ChartAnnotation);
    console.log('Chart.js Annotation プラグインを登録しました');
    return true;
  } else if (typeof window.ChartAnnotation !== 'undefined') {
    Chart.register(window.ChartAnnotation);
    console.log('Chart.js Annotation プラグイン(window)を登録しました');
    return true;
  } else if (typeof chartjs_plugin_annotation !== 'undefined') {
    Chart.register(chartjs_plugin_annotation);
    console.log('Chart.js Annotation プラグイン(chartjs_plugin_annotation)を登録しました');
    return true;
  } else {
    // 新しいバージョンでは自動登録されるはずなので、明示的に再登録を試みる
    try {
      console.log('Annotation プラグインは自動登録されているはずです');
      // アノテーションが機能するか確認 - 修正部分
      let hasAnnotationPlugin = false;
      
      if (Chart.registry.plugins) {
        if (Chart.registry.plugins.items) {
          // itemsがオブジェクトの場合
          if (typeof Chart.registry.plugins.items === 'object' && !Array.isArray(Chart.registry.plugins.items)) {
            hasAnnotationPlugin = Object.values(Chart.registry.plugins.items).some(p => 
              p.id === 'annotation' || (p.id && p.id.includes('annotation')));
          } 
          // itemsが配列の場合
          else if (Array.isArray(Chart.registry.plugins.items)) {
            hasAnnotationPlugin = Chart.registry.plugins.items.some(p => 
              p.id === 'annotation' || (p.id && p.id.includes('annotation')));
          }
        } else {
          // registryの構造が異なる場合、直接チェック
          hasAnnotationPlugin = Object.values(Chart.registry.plugins).some(p => 
            p.id === 'annotation' || (p.id && p.id.includes('annotation')));
        }
      }
      
      if (hasAnnotationPlugin) {
        console.log('Annotation プラグインが登録されています');
        return true;
      } else {
        console.warn('Annotation プラグインが見つかりません');
        return false;
      }
    } catch (e) {
      console.error('Chart.js Annotation プラグインが見つかりません。HTMLファイルに追加してください');
      return false;
    }
  }
}

async function loadSymbolOptions() {
  const exchange = document.getElementById('exchange-select').value;
  const select = document.getElementById('symbol-select');
  select.innerHTML = '';
  if (!exchange) return;
  try {
    const res = await fetch(`/api/symbols?exchange=${exchange}`);
    const symbols = await res.json();
    symbols.forEach(sym => {
      const opt = document.createElement('option');
      opt.value = sym;
      opt.textContent = sym;
      select.appendChild(opt);
    });
    if (symbols.length > 0) {
      // BTC/JPYがあればデフォルトで選択、なければ最初の銘柄を選択
      const btcJpy = symbols.find(sym => sym === 'BTC/JPY');
      if (btcJpy) {
        select.value = btcJpy;
      } else {
        select.value = symbols[0];
      }
      await loadOhlcvData();
    }
  } catch (e) {
    select.innerHTML = '<option>取得失敗</option>';
    console.log(e);
  }
}

function updateOhlcChart(ohlcvData) {
  try {
    registerChartPlugins();

    // チャートが存在する場合は必ず破棄
    if (window.ohlcChart instanceof Chart) {
      window.ohlcChart.destroy();
      window.ohlcChart = null;
    }

    const ctx = document.getElementById('ohlc-chart').getContext('2d');
    // 時間足に応じてX軸の表示形式を最適化
    let timeUnit = 'hour';
    let tooltipFormat = 'yyyy/MM/dd HH:mm';
    
    switch(currentInterval) {
      case '1m':
      case '5m':
      case '15m':
        timeUnit = 'minute';
        break;
      case '1h':
      case '4h':
        timeUnit = 'hour';
        break;
      case '1d':
        timeUnit = 'day';
        tooltipFormat = 'yyyy/MM/dd';
        break;
    }
    
    // 選択された範囲に基づいてタイトル生成
    let titleText = `ローソク足チャート（${getIntervalText(currentInterval)}）`;
    
    switch (currentTimeRange) {
      case 'last_24h':
        titleText += ' - 過去24時間';
        break;
      case 'last_7d':
        titleText += ' - 過去7日間';
        break;
      case 'last_30d':
        titleText += ' - 過去30日間';
        break;
      case 'custom':
        titleText += ' - カスタム範囲';
        break;
    }
    
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: titleText },
        annotation: {
          annotations: {}
        },
        tooltip: {
          callbacks: {
            title: function(items) {
              if (!items.length) return '';
              const date = new Date(items[0].raw.x);
              return date.toLocaleString('ja-JP');
            },
            label: function(item) {
              if (item && item.raw) {
                const data = item.raw;
                return [
                  `始値: ${data.o}`,
                  `高値: ${data.h}`,
                  `安値: ${data.l}`,
                  `終値: ${data.c}`
                ];
              }
              return '';
            }
          },
          intersect: true,
          mode: 'nearest'
        }
      },
      scales: {
        x: { 
          type: 'time', 
          time: { 
            unit: timeUnit,
            tooltipFormat: tooltipFormat,
            displayFormats: {
              minute: 'HH:mm',
              hour: 'MM/dd HH:mm',
              day: 'yyyy/MM/dd'
            }
          },
          adapters: {
            date: {
              locale: 'ja'
            }
          }
        },
        y: { beginAtZero: false }
      }
    };

    // 新しいチャートを作成
    window.ohlcChart = new Chart(ctx, {
      type: 'candlestick',
      data: {
        datasets: [{
          label: 'ローソク足',
          data: ohlcvData,
          color: {
            up: '#26a69a', down: '#ef5350', unchanged: '#ccc'
          }
        }]
      },
      options: chartOptions
    });
    
    // チャート作成後に戦略シグナルを取得して表示
    loadStrategySignals().then(signals => {
      addSignalsToChart(signals);
    });
  } catch (error) {
    console.error('ローソク足チャート作成中にエラーが発生しました:', error);
    
    // エラーの種類を確認
    if (error.message && error.message.includes("is not a registered controller")) {
      console.error('Chart.js Financialプラグインが正しく登録されていません。');
      // プラグインの登録を試みる
      registerFinancialPlugin();
    }
    
    // エラーメッセージを表示
    const canvas = document.getElementById('ohlc-chart');
    const container = canvas.parentElement;
    if (container) {
      container.innerHTML = `<div class="alert alert-danger">
        ローソク足チャートの作成に失敗しました。<br>
        エラー: ${error.message}<br>
        Chart.js Financialプラグインの読み込みを確認してください。
      </div>`;
    }
  }
}

// Chart.js Financialプラグインを明示的に登録する関数
function registerFinancialPlugin() {
  try {
    // プラグインの登録処理
    // 可能性のある複数の名前を確認
    if (typeof ChartFinancial !== 'undefined') {
      Chart.register(ChartFinancial);
      console.log('Chart.js Financialプラグインを登録しました。');
    } else if (typeof window.ChartFinancial !== 'undefined') {
      Chart.register(window.ChartFinancial);
      console.log('Chart.js Financialプラグイン(window.ChartFinancial)を登録しました。');
    } else if (typeof Chart.ChartFinancial !== 'undefined') {
      Chart.register(Chart.ChartFinancial);
      console.log('Chart.js Financialプラグイン(Chart.ChartFinancial)を登録しました。');
    } else if (typeof Chart.Financial !== 'undefined') {
      Chart.register(Chart.Financial);
      console.log('Chart.js Financialプラグイン(Chart.Financial)を登録しました。');
    } else {
      console.error('ChartFinancialオブジェクトが見つかりません。プラグインが正しく読み込まれているか確認してください。');
      
      // HTMLにスクリプトが含まれているか確認するメッセージ
      console.info('HTMLファイルに以下のスクリプトタグが含まれているか確認してください:');
      console.info('<script src="https://cdn.jsdelivr.net/npm/chartjs-chart-financial"></script>');
    }
  } catch (error) {
    console.error('Chart.js Financialプラグインの登録中にエラーが発生しました:', error);
  }
}

/**
 * 時間足の表示用テキストを取得
 */
function getIntervalText(interval) {
  const intervalMap = {
    '1m': '1分足',
    '5m': '5分足',
    '15m': '15分足',
    '1h': '1時間足',
    '4h': '4時間足',
    '1d': '日足'
  };
  return intervalMap[interval] || interval;
}

document.addEventListener('DOMContentLoaded', () => {
  // 既存のコード...
  
  // 時間範囲セレクトボックスのイベントリスナー
  const timeRangeSelect = document.getElementById('time-range-select');
  if (timeRangeSelect) {
    timeRangeSelect.addEventListener('change', handleTimeRangeChange);
  }
  
  // カスタム日時範囲の適用ボタン
  const applyDateRangeBtn = document.getElementById('apply-date-range');
  if (applyDateRangeBtn) {
    applyDateRangeBtn.addEventListener('click', applyTimeRange);
  }
  
  // 初期値の設定
  setDefaultDateRange();
});

/**
 * 時間範囲選択の変更ハンドラ
 */
function handleTimeRangeChange(e) {
  const selectedRange = e.target.value;
  currentTimeRange = selectedRange;
  
  // カスタム範囲選択時のみ日時選択UIを表示
  const customDateRangeDiv = document.getElementById('custom-date-range');
  if (customDateRangeDiv) {
    customDateRangeDiv.style.display = selectedRange === 'custom' ? 'flex' : 'none';
  }
  
  // カスタム以外の範囲が選択された場合は即時適用
  if (selectedRange !== 'custom') {
    applyTimeRange();
  }
}

/**
 * 選択された時間範囲を適用してデータを再読み込み
 */
function applyTimeRange() {
  // カスタム範囲の場合は入力値を取得
  if (currentTimeRange === 'custom') {
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    
    if (startDateInput && startDateInput.value) {
      customStartDate = new Date(startDateInput.value).getTime();
    }
    
    if (endDateInput && endDateInput.value) {
      customEndDate = new Date(endDateInput.value).getTime();
    }
    
    // 日付が正しく設定されているか確認
    if (!customStartDate || !customEndDate || customStartDate >= customEndDate) {
      alert('開始日時と終了日時を正しく設定してください。');
      return;
    }
  }
  
  // データを再読み込み
  loadOhlcvData();
}

/**
 * デフォルトの日時範囲を設定
 */
function setDefaultDateRange() {
  const now = new Date();
  
  // 終了日時はデフォルトで現在時刻
  const endDateInput = document.getElementById('end-date');
  if (endDateInput) {
    endDateInput.value = formatDateTimeForInput(now);
  }
  
  // 開始日時はデフォルトで1週間前
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startDateInput = document.getElementById('start-date');
  if (startDateInput) {
    startDateInput.value = formatDateTimeForInput(oneWeekAgo);
  }
}

/**
 * Date オブジェクトを datetime-local 入力用の文字列に変換
 */
function formatDateTimeForInput(date) {
  return date.toISOString().slice(0, 16); // YYYY-MM-DDThh:mm 形式
}

async function loadInitialData() {
  await loadExchangeOptions();
  await loadStrategyOptions(); // 新しく追加
}

async function loadStrategyOptions() {
  const exchange = document.getElementById('exchange-select').value;
  const symbol = document.getElementById('symbol-select').value;
  const select = document.getElementById('strategy-select');
  select.innerHTML = '';
  try {
    const params = new URLSearchParams();
    params.append('exchange', exchange);
    params.append('symbol', symbol);
    const res = await fetch(`/api/strategies?${params.toString()}`);
    const strategies = await res.json();
    console.log(strategies)
    
    // すべての戦略を表示するオプションを最初に追加
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'すべての戦略';
    select.appendChild(allOption);
    
    // 各戦略をオプションとして追加
    strategies.forEach(strategy => {
      const opt = document.createElement('option');
      opt.value = strategy;
      opt.textContent = strategy;
      select.appendChild(opt);
    });
  } catch (e) {
    select.innerHTML = '<option>取得失敗</option>';
    console.log('戦略一覧の取得に失敗しました:', e);
  }
}

/**
 * 戦略変更時のハンドラ
 */
function handleStrategyChange() {
  // ローソク足データを再読み込み（シグナル表示も更新される）
  loadOhlcvData();
}

/**
 * ロケール設定を日本語にしてタイムゾーン表示を適正化
 */
document.addEventListener('DOMContentLoaded', () => {
  // 既存コード...
  
  // 日付のロケール設定
  if (typeof Chart !== 'undefined' && Chart.defaults) {
    Chart.defaults.locale = 'ja-JP';
  }
});