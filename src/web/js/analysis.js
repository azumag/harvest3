/**
 * 分析画面の機能を制御するスクリプト
 */

// グローバル変数
let currentPeriod = 'daily';
let currentInterval = '1h'; // デフォルトは1時間足
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
      select.value = symbols[0];
      await loadOhlcvData();
    }
  } catch (e) {
    select.innerHTML = '<option>取得失敗</option>';
  }
}

async function loadOhlcvData() {
  const exchange = document.getElementById('exchange-select').value;
  const symbol = document.getElementById('symbol-select').value;
  const interval = currentInterval; // グローバル変数から時間足を取得
  const limit = 100;
  if (!exchange || !symbol) return;
  try {
    const params = new URLSearchParams({ exchange, symbol, interval, limit });
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
  }
}

function updateOhlcChart(ohlcvData) {
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
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: `ローソク足チャート（${getIntervalText(currentInterval)}）` }
    },
    scales: {
      x: { 
        type: 'time', 
        time: { 
          unit: timeUnit,
          tooltipFormat: tooltipFormat 
        } 
      },
      y: { beginAtZero: false }
    }
  };
  if (ohlcChart) {
    ohlcChart.data.datasets[0].data = ohlcvData;
    ohlcChart.options = chartOptions;
    ohlcChart.update();
    return;
  }
  ohlcChart = new Chart(ctx, {
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
  // Chart.jsが読み込まれているか確認
  if (typeof Chart === 'undefined') {
    console.error('Chart.jsが読み込まれていません。ページを再読み込みしてください。');
    // エラーメッセージを表示
    document.querySelectorAll('.chart-container').forEach(container => {
      container.innerHTML = '<div class="alert alert-danger">チャートの読み込みに失敗しました。ページを再読み込みしてください。</div>';
    });
    return; // Chart.jsが読み込まれていない場合は初期化をスキップ
  }
  
  console.log('Chart.jsの読み込み状態: Chart.js読み込み済み');
  
  // チャートを初期化
  initializeCharts();
  
  // 期間ボタンのイベントリスナー設定
  document.querySelectorAll('.period-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      const period = e.target.getAttribute('data-period');
      setActivePeriod(period);
      loadAnalysisData();
    });
  });
  
  // 時間足選択ボタンのイベントリスナー設定
  document.querySelectorAll('.interval-btn').forEach(button => {
    button.addEventListener('click', (e) => {
      const interval = e.target.getAttribute('data-interval');
      setActiveInterval(interval);
    });
  });
  
  // 表示切替チェックボックスのイベントリスナー設定
  document.getElementById('show-buy-trades').addEventListener('change', updateTimeSeriesChart);
  document.getElementById('show-sell-trades').addEventListener('change', updateTimeSeriesChart);
  document.getElementById('show-cumulative-pnl').addEventListener('change', updateTimeSeriesChart);
  
  // 初期データ読み込み
  loadAnalysisData();
  
  // リアルタイム更新の設定
  setupRealtimeUpdates();
  loadExchangeOptions();
  document.getElementById('exchange-select').addEventListener('change', loadSymbolOptions);
  document.getElementById('symbol-select').addEventListener('change', loadOhlcvData);
});

/**
 * アクティブな期間を設定
 * @param {string} period - 期間（daily, weekly, monthly, yearly, all）
 */
function setActivePeriod(period) {
  currentPeriod = period;
  
  // ボタンのアクティブ状態を更新
  document.querySelectorAll('.period-btn').forEach(btn => {
    if (btn.getAttribute('data-period') === period) {
      btn.classList.remove('btn-outline-primary');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline-primary');
    }
  });
}

/**
 * 選択された時間足を設定する
 * @param {string} interval - 時間足（例: '1m', '5m', '15m', '1h', '4h', '1d'）
 */
function setActiveInterval(interval) {
  currentInterval = interval;
  
  // ボタンのアクティブ状態を更新
  document.querySelectorAll('.interval-btn').forEach(btn => {
    if (btn.getAttribute('data-interval') === interval) {
      btn.classList.remove('btn-outline-primary');
      btn.classList.add('btn-primary');
    } else {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline-primary');
    }
  });
  
  // 選択された時間足でチャートを更新
  loadOhlcvData();
}

/**
 * チャートを初期化
 */
function initializeCharts() {
  // 時系列チャート
  const timeSeriesCtx = document.getElementById('time-series-chart').getContext('2d');
  
  if (typeof Chart === 'undefined') {
    console.error('Chart.jsライブラリが読み込まれていません。');
    return; // チャート初期化を中止
  }
  
  try {
    charts.timeSeriesChart = new Chart(timeSeriesCtx, {
    type: 'line',
    data: {
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'day',
            displayFormats: {
              day: 'MM/dd'
            },
            tooltipFormat: 'yyyy/MM/dd HH:mm'
          },
          title: {
            display: true,
            text: '日時'
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: '金額 (円)'
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: '時系列取引データ'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      }
    }
  });
  
  // 戦略パフォーマンスチャート
  const strategyCtx = document.getElementById('strategy-performance-chart').getContext('2d');
  charts.strategyPerformanceChart = new Chart(strategyCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: '損益 (円)'
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: '戦略別パフォーマンス'
        }
      }
    }
  });
  
  // 取引所パフォーマンスチャート
  const exchangeCtx = document.getElementById('exchange-performance-chart').getContext('2d');
  charts.exchangePerformanceChart = new Chart(exchangeCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: '損益 (円)'
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: '取引所別パフォーマンス'
        }
      }
    }
  });
  
  // 時間帯別取引量チャート
  const hourlyCtx = document.getElementById('hourly-volume-chart').getContext('2d');
  charts.hourlyVolumeChart = new Chart(hourlyCtx, {
    type: 'bar',
    data: {
      labels: Array.from({length: 24}, (_, i) => `${i}時`),
      datasets: [
        {
          label: '取引量',
          data: Array(24).fill(0),
          backgroundColor: 'rgba(54, 162, 235, 0.7)',
          borderColor: 'rgb(54, 162, 235)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: '取引回数'
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: '時間帯別取引量'
        }
      }
    }
  });
  
  // 取引サイズ分布チャート
  const sizeCtx = document.getElementById('trade-size-distribution-chart').getContext('2d');
  charts.tradeSizeDistributionChart = new Chart(sizeCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: '取引数',
          data: [],
          backgroundColor: 'rgba(153, 102, 255, 0.7)',
          borderColor: 'rgb(153, 102, 255)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: '取引回数'
          }
        },
        x: {
          title: {
            display: true,
            text: '取引サイズ'
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: '取引サイズ分布'
        }
      }
    }
  });
  } catch (error) {
    console.error('チャートの初期化中にエラーが発生しました:', error);
  }
}

/**
 * 分析データを読み込む
 */
function loadAnalysisData() {
  // 1. 取引履歴データを取得して時系列チャートを更新
  loadTimeSeriesData();
  
  // 2. サマリーデータを取得して戦略・取引所パフォーマンスを更新
  loadSummaryData();
  
  // 3. 詳細な統計分析のためのデータを取得
  loadDetailedAnalysisData();
}

/**
 * 時系列データを読み込む
 */
function loadTimeSeriesData() {
  // 期間に応じたクエリパラメータを設定
  const params = new URLSearchParams();
  
  if (currentPeriod !== 'all') {
    const now = Date.now();
    let startTime = now;
    
    if (currentPeriod === 'daily') {
      startTime = now - 24 * 60 * 60 * 1000; // 24時間前
    } else if (currentPeriod === 'weekly') {
      startTime = now - 7 * 24 * 60 * 60 * 1000; // 7日前
    } else if (currentPeriod === 'monthly') {
      startTime = now - 30 * 24 * 60 * 60 * 1000; // 30日前
    } else if (currentPeriod === 'yearly') {
      startTime = now - 365 * 24 * 60 * 60 * 1000; // 365日前
    }
    
    params.append('startDate', startTime);
  }
  
  params.append('limit', 1000); // 十分なデータポイント数を取得
  
  // APIからデータ取得
  fetch(`/api/filled-history?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      if (!data.history || data.history.length === 0) {
        resetTimeSeriesChart();
        return;
      }
      
      // データを時系列順に並べ替え
      const sortedData = [...data.history].sort((a, b) => a.timestamp - b.timestamp);
      
      // 時系列チャートを更新
      updateTimeSeriesChartData(sortedData);
    })
    .catch(error => {
      console.error('時系列データの取得に失敗しました:', error);
      resetTimeSeriesChart();
    });
}

/**
 * 時系列チャートのデータを更新
 * @param {Array} tradeData - 取引履歴データ
 */
function updateTimeSeriesChartData(tradeData) {
  // チャートが初期化されていない場合は処理をスキップ
  if (!charts.timeSeriesChart) {
    console.warn('時系列チャートが初期化されていないため、データを更新できません。');
    return;
  }
  
  // 買い取引と売り取引のデータポイントを準備
  const buyData = [];
  const sellData = [];
  let cumulativePnL = 0;
  const pnlData = [];
  
  // データポイントを作成
  tradeData.forEach(trade => {
    const point = {
      x: trade.timestamp,
      y: trade.value
    };
    
    if (trade.side === 'buy') {
      buyData.push(point);
      cumulativePnL -= trade.value;
    } else {
      sellData.push(point);
      cumulativePnL += trade.value;
    }
    
    pnlData.push({
      x: trade.timestamp,
      y: cumulativePnL
    });
  });
  
  // チャートデータを更新
  charts.timeSeriesChart.data.datasets = [
    {
      label: '買い取引',
      data: buyData,
      backgroundColor: chartColors.buy,
      borderColor: chartColors.buy,
      pointRadius: 3,
      pointHoverRadius: 5,
      showLine: false,
      hidden: !document.getElementById('show-buy-trades').checked
    },
    {
      label: '売り取引',
      data: sellData,
      backgroundColor: chartColors.sell,
      borderColor: chartColors.sell,
      pointRadius: 3,
      pointHoverRadius: 5,
      showLine: false,
      hidden: !document.getElementById('show-sell-trades').checked
    },
    {
      label: '累積損益',
      data: pnlData,
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderColor: chartColors.profit,
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      hidden: !document.getElementById('show-cumulative-pnl').checked
    }
  ];
  
  // X軸のスケール単位を設定
  const timeUnit = getTimeUnit(currentPeriod);
  charts.timeSeriesChart.options.scales.x.time.unit = timeUnit;
  
  // チャートのタイトルを更新
  charts.timeSeriesChart.options.plugins.title.text = `時系列取引データ (${getPeriodText(currentPeriod)})`;
  
  // チャート更新
  charts.timeSeriesChart.update();
}

/**
 * 時間単位を取得
 * @param {string} period - 期間
 * @returns {string} - 時間単位
 */
function getTimeUnit(period) {
  switch (period) {
    case 'daily': return 'hour';
    case 'weekly': return 'day';
    case 'monthly': return 'day';
    case 'yearly': return 'month';
    case 'all': 
    default: return 'month';
  }
}

/**
 * 時系列チャート表示を更新（チェックボックス変更時）
 */
function updateTimeSeriesChart() {
  const showBuy = document.getElementById('show-buy-trades').checked;
  const showSell = document.getElementById('show-sell-trades').checked;
  const showPnL = document.getElementById('show-cumulative-pnl').checked;
  
  if (charts.timeSeriesChart && charts.timeSeriesChart.data.datasets.length === 3) {
    charts.timeSeriesChart.data.datasets[0].hidden = !showBuy;
    charts.timeSeriesChart.data.datasets[1].hidden = !showSell;
    charts.timeSeriesChart.data.datasets[2].hidden = !showPnL;
    charts.timeSeriesChart.update();
  }
}

/**
 * 時系列チャートをリセット
 */
function resetTimeSeriesChart() {
  if (charts.timeSeriesChart) {
    try {
      charts.timeSeriesChart.data.datasets = [];
      charts.timeSeriesChart.update();
    } catch (error) {
      console.error('時系列チャートのリセット中にエラーが発生しました:', error);
    }
  }
}

/**
 * サマリーデータを読み込む
 */
function loadSummaryData() {
  // APIからデータ取得
  fetch(`/api/summary?period=${currentPeriod}`)
    .then(response => response.json())
    .then(data => {
      // 戦略別パフォーマンスチャートを更新
      updateStrategyPerformanceChart(data.byStrategy);
      
      // 取引所別パフォーマンスチャートを更新
      updateExchangePerformanceChart(data.byExchange);
    })
    .catch(error => {
      console.error('サマリーデータの取得に失敗しました:', error);
      // チャートをリセット
      resetPerformanceCharts();
    });
}

/**
 * 戦略別パフォーマンスチャートを更新
 * @param {Object} strategyData - 戦略別データ
 */
function updateStrategyPerformanceChart(strategyData) {
  if (!strategyData || Object.keys(strategyData).length === 0) {
    resetStrategyPerformanceChart();
    return;
  }
  
  const labels = [];
  const realizedPnL = [];
  const totalBuyAmount = [];
  const totalSellAmount = [];
  
  // データを抽出
  Object.keys(strategyData).forEach((key, index) => {
    const strategy = strategyData[key];
    labels.push(key);
    realizedPnL.push(strategy.realizedPnL);
    totalBuyAmount.push(strategy.totalBuyAmount);
    totalSellAmount.push(strategy.totalSellAmount);
  });
  
  // チャートデータを更新
  charts.strategyPerformanceChart.data.labels = labels;
  charts.strategyPerformanceChart.data.datasets = [
    {
      label: '実現損益',
      data: realizedPnL,
      backgroundColor: realizedPnL.map(value => value >= 0 ? chartColors.buy : chartColors.sell),
      borderColor: realizedPnL.map(value => value >= 0 ? 'rgb(40, 167, 69)' : 'rgb(220, 53, 69)'),
      borderWidth: 1
    }
  ];
  
  // チャートのタイトルを更新
  charts.strategyPerformanceChart.options.plugins.title.text = `戦略別パフォーマンス (${getPeriodText(currentPeriod)})`;
  
  // チャート更新
  charts.strategyPerformanceChart.update();
}

/**
 * 取引所別パフォーマンスチャートを更新
 * @param {Object} exchangeData - 取引所別データ
 */
function updateExchangePerformanceChart(exchangeData) {
  if (!exchangeData || Object.keys(exchangeData).length === 0) {
    resetExchangePerformanceChart();
    return;
  }
  
  const labels = [];
  const realizedPnL = [];
  const totalBuyAmount = [];
  const totalSellAmount = [];
  
  // データを抽出
  Object.keys(exchangeData).forEach((key, index) => {
    const exchange = exchangeData[key];
    labels.push(key);
    realizedPnL.push(exchange.realizedPnL);
    totalBuyAmount.push(exchange.totalBuyAmount);
    totalSellAmount.push(exchange.totalSellAmount);
  });
  
  // チャートデータを更新
  charts.exchangePerformanceChart.data.labels = labels;
  charts.exchangePerformanceChart.data.datasets = [
    {
      label: '実現損益',
      data: realizedPnL,
      backgroundColor: realizedPnL.map(value => value >= 0 ? chartColors.buy : chartColors.sell),
      borderColor: realizedPnL.map(value => value >= 0 ? 'rgb(40, 167, 69)' : 'rgb(220, 53, 69)'),
      borderWidth: 1
    }
  ];
  
  // チャートのタイトルを更新
  charts.exchangePerformanceChart.options.plugins.title.text = `取引所別パフォーマンス (${getPeriodText(currentPeriod)})`;
  
  // チャート更新
  charts.exchangePerformanceChart.update();
}

/**
 * パフォーマンスチャートをリセット
 */
function resetPerformanceCharts() {
  resetStrategyPerformanceChart();
  resetExchangePerformanceChart();
}

/**
 * 戦略パフォーマンスチャートをリセット
 */
function resetStrategyPerformanceChart() {
  if (charts.strategyPerformanceChart) {
    charts.strategyPerformanceChart.data.labels = [];
    charts.strategyPerformanceChart.data.datasets = [];
    charts.strategyPerformanceChart.update();
  }
}

/**
 * 取引所パフォーマンスチャートをリセット
 */
function resetExchangePerformanceChart() {
  if (charts.exchangePerformanceChart) {
    charts.exchangePerformanceChart.data.labels = [];
    charts.exchangePerformanceChart.data.datasets = [];
    charts.exchangePerformanceChart.update();
  }
}

/**
 * 詳細な分析データを読み込む
 */
function loadDetailedAnalysisData() {
  // 期間に応じたクエリパラメータを設定
  const params = new URLSearchParams();
  
  if (currentPeriod !== 'all') {
    const now = Date.now();
    let startTime = now;
    
    if (currentPeriod === 'daily') {
      startTime = now - 24 * 60 * 60 * 1000; // 24時間前
    } else if (currentPeriod === 'weekly') {
      startTime = now - 7 * 24 * 60 * 60 * 1000; // 7日前
    } else if (currentPeriod === 'monthly') {
      startTime = now - 30 * 24 * 60 * 60 * 1000; // 30日前
    } else if (currentPeriod === 'yearly') {
      startTime = now - 365 * 24 * 60 * 60 * 1000; // 365日前
    }
    
    params.append('startDate', startTime);
  }
  
  params.append('limit', 1000); // 十分なデータポイント数を取得
  
  // APIからデータ取得
  fetch(`/api/filled-history?${params.toString()}`)
    .then(response => response.json())
    .then(data => {
      if (!data.history || data.history.length === 0) {
        resetAnalysisCharts();
        updateStatsTable(null);
        return;
      }
      
      // 時間帯別取引量の分析
      analyzeHourlyVolume(data.history);
      
      // 取引サイズ分布の分析
      analyzeTradeSizeDistribution(data.history);
      
      // 統計サマリーテーブルの更新
      updateStatsTable(data.history);
    })
    .catch(error => {
      console.error('分析データの取得に失敗しました:', error);
      resetAnalysisCharts();
      updateStatsTable(null);
    });
}

/**
 * 時間帯別取引量を分析
 * @param {Array} tradeData - 取引履歴データ
 */
function analyzeHourlyVolume(tradeData) {
  // 時間帯ごとにカウント
  const hourlyCount = Array(24).fill(0);
  
  tradeData.forEach(trade => {
    const hour = new Date(trade.timestamp).getHours();
    hourlyCount[hour]++;
  });
  
  // チャートデータを更新
  charts.hourlyVolumeChart.data.datasets[0].data = hourlyCount;
  
  // チャートのタイトルを更新
  charts.hourlyVolumeChart.options.plugins.title.text = `時間帯別取引量 (${getPeriodText(currentPeriod)})`;
  
  // チャート更新
  charts.hourlyVolumeChart.update();
}

/**
 * 取引サイズ分布を分析
 * @param {Array} tradeData - 取引履歴データ
 */
function analyzeTradeSizeDistribution(tradeData) {
  if (!tradeData || tradeData.length === 0) {
    resetTradeSizeChart();
    return;
  }
  
  // 取引サイズを抽出
  const tradeSizes = tradeData.map(trade => trade.amount);
  
  // 最小値と最大値を特定
  const minSize = Math.min(...tradeSizes);
  const maxSize = Math.max(...tradeSizes);
  
  // ビンの数を決定（10ビン）
  const binCount = Math.min(10, Math.ceil((maxSize - minSize) * 100));
  const binSize = (maxSize - minSize) / binCount;
  
  // 各ビンの範囲とカウントを計算
  const bins = Array(binCount).fill(0);
  const binLabels = [];
  
  for (let i = 0; i < binCount; i++) {
    const startValue = minSize + i * binSize;
    const endValue = minSize + (i + 1) * binSize;
    binLabels.push(`${startValue.toFixed(4)}-${endValue.toFixed(4)}`);
  }
  
  // 各取引をビンに分類
  tradeSizes.forEach(size => {
    // 最大値はぴったり最後のビンに入るようにする
    if (size === maxSize) {
      bins[binCount - 1]++;
    } else {
      const binIndex = Math.floor((size - minSize) / binSize);
      bins[binIndex]++;
    }
  });
  
  // チャートデータを更新
  charts.tradeSizeDistributionChart.data.labels = binLabels;
  charts.tradeSizeDistributionChart.data.datasets[0].data = bins;
  
  // チャートのタイトルを更新
  charts.tradeSizeDistributionChart.options.plugins.title.text = `取引サイズ分布 (${getPeriodText(currentPeriod)})`;
  
  // チャート更新
  charts.tradeSizeDistributionChart.update();
}

/**
 * 取引サイズチャートをリセット
 */
function resetTradeSizeChart() {
  if (charts.tradeSizeDistributionChart) {
    charts.tradeSizeDistributionChart.data.labels = [];
    charts.tradeSizeDistributionChart.data.datasets[0].data = [];
    charts.tradeSizeDistributionChart.update();
  }
}

/**
 * 分析チャートをリセット
 */
function resetAnalysisCharts() {
  // 時間帯チャートのリセット
  if (charts.hourlyVolumeChart) {
    charts.hourlyVolumeChart.data.datasets[0].data = Array(24).fill(0);
    charts.hourlyVolumeChart.update();
  }
  
  // 取引サイズチャートのリセット
  resetTradeSizeChart();
}

/**
 * 統計情報テーブルを更新
 * @param {Array} tradeData - 取引履歴データ
 */
function updateStatsTable(tradeData) {
  const tableBody = document.getElementById('stats-table-body');
  
  if (!tradeData || tradeData.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center">データがありません</td>
      </tr>
    `;
    return;
  }
  
  // 全体、買い、売りの取引を分離
  const allTrades = tradeData;
  const buyTrades = tradeData.filter(trade => trade.side === 'buy');
  const sellTrades = tradeData.filter(trade => trade.side === 'sell');
  
  // 統計情報を計算
  const stats = {
    totalCount: allTrades.length,
    buyCount: buyTrades.length,
    sellCount: sellTrades.length,
    totalVolume: calculateSum(allTrades, 'amount'),
    buyVolume: calculateSum(buyTrades, 'amount'),
    sellVolume: calculateSum(sellTrades, 'amount'),
    totalValue: calculateSum(allTrades, 'value'),
    buyValue: calculateSum(buyTrades, 'value'),
    sellValue: calculateSum(sellTrades, 'value'),
    avgTradeSize: calculateAverage(allTrades, 'amount'),
    avgBuySize: calculateAverage(buyTrades, 'amount'),
    avgSellSize: calculateAverage(sellTrades, 'amount'),
    avgTradeValue: calculateAverage(allTrades, 'value'),
    avgBuyValue: calculateAverage(buyTrades, 'value'),
    avgSellValue: calculateAverage(sellTrades, 'value'),
    medianTradeSize: calculateMedian(allTrades.map(t => t.amount)),
    medianBuySize: calculateMedian(buyTrades.map(t => t.amount)),
    medianSellSize: calculateMedian(sellTrades.map(t => t.amount)),
    maxTradeSize: Math.max(...allTrades.map(t => t.amount)),
    maxBuySize: buyTrades.length > 0 ? Math.max(...buyTrades.map(t => t.amount)) : 0,
    maxSellSize: sellTrades.length > 0 ? Math.max(...sellTrades.map(t => t.amount)) : 0
  };
  
  // 統計テーブルのHTML生成
  tableBody.innerHTML = `
    <tr>
      <td>取引回数</td>
      <td>${stats.totalCount.toLocaleString()}</td>
      <td>${stats.buyCount.toLocaleString()}</td>
      <td>${stats.sellCount.toLocaleString()}</td>
    </tr>
    <tr>
      <td>総取引量</td>
      <td>${stats.totalVolume.toFixed(6)}</td>
      <td>${stats.buyVolume.toFixed(6)}</td>
      <td>${stats.sellVolume.toFixed(6)}</td>
    </tr>
    <tr>
      <td>総取引金額</td>
      <td>${stats.totalValue.toLocaleString()} 円</td>
      <td>${stats.buyValue.toLocaleString()} 円</td>
      <td>${stats.sellValue.toLocaleString()} 円</td>
    </tr>
    <tr>
      <td>平均取引サイズ</td>
      <td>${stats.avgTradeSize.toFixed(6)}</td>
      <td>${stats.avgBuySize.toFixed(6)}</td>
      <td>${stats.avgSellSize.toFixed(6)}</td>
    </tr>
    <tr>
      <td>平均取引金額</td>
      <td>${stats.avgTradeValue.toLocaleString()} 円</td>
      <td>${stats.avgBuyValue.toLocaleString()} 円</td>
      <td>${stats.avgSellValue.toLocaleString()} 円</td>
    </tr>
    <tr>
      <td>中央値取引サイズ</td>
      <td>${stats.medianTradeSize.toFixed(6)}</td>
      <td>${stats.medianBuySize.toFixed(6)}</td>
      <td>${stats.medianSellSize.toFixed(6)}</td>
    </tr>
    <tr>
      <td>最大取引サイズ</td>
      <td>${stats.maxTradeSize.toFixed(6)}</td>
      <td>${stats.maxBuySize.toFixed(6)}</td>
      <td>${stats.maxSellSize.toFixed(6)}</td>
    </tr>
  `;
}

/**
 * 配列から特定プロパティの合計を計算
 * @param {Array} array - 対象配列
 * @param {string} property - 合計するプロパティ名
 * @returns {number} - 合計値
 */
function calculateSum(array, property) {
  return array.reduce((sum, item) => sum + item[property], 0);
}

/**
 * 配列から特定プロパティの平均を計算
 * @param {Array} array - 対象配列
 * @param {string} property - 平均するプロパティ名
 * @returns {number} - 平均値
 */
function calculateAverage(array, property) {
  if (array.length === 0) return 0;
  return calculateSum(array, property) / array.length;
}

/**
 * 配列の中央値を計算
 * @param {Array} array - 数値配列
 * @returns {number} - 中央値
 */
function calculateMedian(array) {
  if (array.length === 0) return 0;
  
  // 配列をソート
  const sorted = [...array].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  
  // 配列の長さが奇数か偶数かで計算方法が異なる
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  } else {
    return sorted[middle];
  }
}

/**
 * 期間テキストを取得
 * @param {string} period - 期間キー
 * @returns {string} - 表示用のテキスト
 */
function getPeriodText(period) {
  switch (period) {
    case 'daily': return '24時間';
    case 'weekly': return '1週間';
    case 'monthly': return '1ヶ月';
    case 'yearly': return '1年間';
    case 'all': 
    default: return '全期間';
  }
}

/**
 * リアルタイム更新の設定
 */
function setupRealtimeUpdates() {
  // 取引追加イベント（一定間隔でデータを更新）
  let updateScheduled = false;
  
  realtimeUpdater.addListener('trade_added', () => {
    if (!updateScheduled) {
      updateScheduled = true;
      setTimeout(() => {
        loadAnalysisData();
        updateScheduled = false;
      }, 10000); // 10秒ごとに更新（頻繁な更新を避けるため）
    }
  });
}