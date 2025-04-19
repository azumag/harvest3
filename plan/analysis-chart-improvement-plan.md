# 分析チャート改善計画

## 目的

分析画面に表示されるチャートに関する以下の問題と改善要求を対応します：

1. 戦略シグナルデータの取得エラー修正（`TypeError: data.map is not a function`）
2. ローソク足チャートのエラー修正と機能復元（`Error: "candlestick" is not a registered controller.`）
3. 取引所・銘柄・戦略を選択できるフィルター機能の追加
4. 表示期間を上部のボタン（日次、全期間など）と連動させる機能の追加

## 実装計画

### 1. フィルター機能のUIの追加

以下のフィルターをHTMLに追加します：

- 取引所選択（ドロップダウン）
- 銘柄選択（ドロップダウン）
- 戦略選択（ドロップダウン）

```html
<!-- フィルターセクション -->
<div class="row mb-4">
  <div class="col-12">
    <div class="card">
      <div class="card-body">
        <h5 class="card-title">チャートフィルター</h5>
        <div class="row">
          <div class="col-md-4 mb-2">
            <label for="exchange-select" class="form-label">取引所</label>
            <select id="exchange-select" class="form-select">
              <option value="">すべて</option>
              <!-- APIから動的に取得 -->
            </select>
          </div>
          <div class="col-md-4 mb-2">
            <label for="symbol-select" class="form-label">銘柄</label>
            <select id="symbol-select" class="form-select">
              <option value="">すべて</option>
              <!-- 取引所選択に応じて動的に変更 -->
            </select>
          </div>
          <div class="col-md-4 mb-2">
            <label for="strategy-select" class="form-label">戦略</label>
            <select id="strategy-select" class="form-select">
              <option value="">すべて</option>
              <!-- APIから動的に取得 -->
            </select>
          </div>
        </div>
        <div class="row mt-2">
          <div class="col-12">
            <button id="apply-filter-btn" class="btn btn-primary">フィルター適用</button>
            <button id="reset-filter-btn" class="btn btn-outline-secondary ms-2">リセット</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### 2. ローソク足チャート表示の復元

1. Chart.js拡張プラグイン「chartjs-chart-financial」の追加

```html
<!-- Chart.js拡張プラグイン - ローソク足チャート用 -->
<script src="https://cdn.jsdelivr.net/npm/chartjs-chart-financial@0.1.1/dist/chartjs-chart-financial.min.js"></script>
```

2. チャート初期化コードの修正

```javascript
// ローソク足チャート
const ohlcvCtx = document.getElementById('ohlcv-chart').getContext('2d');
charts.ohlcvChart = new Chart(ohlcvCtx, {
  type: 'candlestick',
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
        beginAtZero: false,
        title: {
          display: true,
          text: '価格'
        }
      }
    },
    plugins: {
      title: {
        display: true,
        text: 'ローソク足チャート'
      },
      tooltip: {
        mode: 'index',
        intersect: false
      }
    }
  }
});
```

3. データ処理コードの修正

```javascript
// OHLCVデータをChart.jsで描画できる形式に変換
const ohlcvData = data.map(item => ({
  x: item[0], // タイムスタンプ
  o: item[1], // 始値
  h: item[2], // 高値
  l: item[3], // 安値
  c: item[4]  // 終値
}));

// チャートデータを更新
charts.ohlcvChart.data.datasets = [{
  label: 'ローソク足',
  data: ohlcvData
}];
```

### 3. フィルター機能のJavaScript実装

1. フィルター要素の参照取得
2. 取引所一覧の取得と選択肢への設定
3. 取引所選択時の銘柄選択肢更新
4. フィルター適用ボタンイベント処理

```javascript
// フィルター要素
const exchangeSelect = document.getElementById('exchange-select');
const symbolSelect = document.getElementById('symbol-select');
const strategySelect = document.getElementById('strategy-select');
const applyFilterBtn = document.getElementById('apply-filter-btn');
const resetFilterBtn = document.getElementById('reset-filter-btn');

// フィルター情報を読み込む
async function loadFilterOptions() {
  try {
    // 取引所一覧を取得
    const exchangesResponse = await fetch('/api/exchanges');
    const exchanges = await exchangesResponse.json();
    
    // 取引所選択肢を設定
    exchanges.forEach(exchange => {
      const option = document.createElement('option');
      option.value = exchange;
      option.textContent = exchange;
      exchangeSelect.appendChild(option);
    });
    
    // 戦略一覧を取得
    const strategiesResponse = await fetch('/api/strategies');
    const strategies = await strategiesResponse.json();
    
    // 戦略選択肢を設定
    strategies.forEach(strategy => {
      const option = document.createElement('option');
      option.value = strategy;
      option.textContent = strategy;
      strategySelect.appendChild(option);
    });
  } catch (error) {
    console.error('フィルター選択肢の読み込みに失敗しました:', error);
  }
}

// 取引所選択時の処理
exchangeSelect.addEventListener('change', async () => {
  const selectedExchange = exchangeSelect.value;
  
  // 選択されていない場合はクリア
  if (!selectedExchange) {
    symbolSelect.innerHTML = '<option value="">すべて</option>';
    return;
  }
  
  try {
    // 選択された取引所の銘柄一覧を取得
    const symbolsResponse = await fetch(`/api/symbols?exchange=${selectedExchange}`);
    const symbols = await symbolsResponse.json();
    
    // 銘柄選択肢を設定
    symbolSelect.innerHTML = '<option value="">すべて</option>';
    symbols.forEach(symbol => {
      const option = document.createElement('option');
      option.value = symbol;
      option.textContent = symbol;
      symbolSelect.appendChild(option);
    });
  } catch (error) {
    console.error('銘柄一覧の読み込みに失敗しました:', error);
  }
});

// フィルター適用ボタンの処理
applyFilterBtn.addEventListener('click', () => {
  loadOhlcvData();
  loadStrategySignalDataForChart();
});

// フィルターリセットボタンの処理
resetFilterBtn.addEventListener('click', () => {
  exchangeSelect.value = '';
  symbolSelect.innerHTML = '<option value="">すべて</option>';
  strategySelect.value = '';
  loadOhlcvData();
  loadStrategySignalDataForChart();
});
```

### 4. OHLCV データ取得関数の修正

フィルター選択と期間選択を連動させます：

```javascript
async function loadOhlcvData() {
  const params = new URLSearchParams();
  
  // 選択された取引所・銘柄でフィルタリング
  const selectedExchange = document.getElementById('exchange-select').value;
  const selectedSymbol = document.getElementById('symbol-select').value;
  
  // デフォルト値設定
  params.append('exchange', selectedExchange || 'bitbank');
  params.append('symbol', selectedSymbol || 'XRP/JPY');
  params.append('interval', '1h');
  params.append('limit', 100);
  
  // 期間フィルタリング
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
    
    params.append('start_time', startTime);
  }
  
  try {
    const response = await fetch(`/api/ohlcv?${params.toString()}`);
    const data = await response.json();
    
    if (!data || data.length === 0) {
      console.warn('ローソク足データがありません');
      return;
    }
    
    // OHLCVデータをChart.jsで描画できる形式に変換
    const ohlcvData = data.map(item => ({
      x: item[0], // タイムスタンプ
      o: item[1], // 始値
      h: item[2], // 高値
      l: item[3], // 安値
      c: item[4]  // 終値
    }));
    
    // チャートデータを更新
    charts.ohlcvChart.data.datasets = [{
      label: 'ローソク足',
      data: ohlcvData
    }];
    
    charts.ohlcvChart.update();
  } catch (error) {
    console.error('ローソク足データの取得に失敗しました:', error);
  }
}
```

### 5. 戦略シグナルデータ取得関数の修正

フィルター選択と期間選択を連動させます：

```javascript
async function loadStrategySignalDataForChart() {
  const params = new URLSearchParams();
  
  // 選択された取引所・銘柄・戦略でフィルタリング
  const selectedExchange = document.getElementById('exchange-select').value;
  const selectedSymbol = document.getElementById('symbol-select').value;
  const selectedStrategy = document.getElementById('strategy-select').value;
  
  if (selectedExchange) {
    params.append('exchange', selectedExchange);
  }
  
  if (selectedSymbol) {
    params.append('symbol', selectedSymbol);
  }
  
  if (selectedStrategy) {
    params.append('strategy', selectedStrategy);
  }
  
  // 期間フィルタリング
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
    
    params.append('start_time', startTime);
  }
  
  try {
    const response = await fetch(`/api/strategy-signals?${params.toString()}`);
    const data = await response.json();
    
    if (!data || data.data.length === 0) {
      console.warn('戦略シグナルデータがありません');
      return;
    }
    
    // 戦略シグナルデータをChart.jsで描画できる形式に変換
    const signalData = data.data.map(item => ({
      x: item.timestamp, // タイムスタンプ
      y: item.price,     // 価格
      signalType: item.signalType // シグナルタイプ (buy/sell)
    }));
    
    // 既存のシグナルデータセットを削除（複数回の更新を防ぐため）
    charts.ohlcvChart.data.datasets = charts.ohlcvChart.data.datasets.filter(dataset => 
      dataset.label !== '戦略シグナル'
    );
    
    // 新しいデータセットとしてシグナルをチャートに追加
    charts.ohlcvChart.data.datasets.push({
      label: '戦略シグナル',
      data: signalData,
      type: 'scatter', // 散布図として表示
      pointRadius: 5,
      pointBackgroundColor: signalData.map(signal => signal.signalType === 'buy' ? 'green' : 'red'),
      pointBorderColor: 'black',
      xAxisID: 'x',
      yAxisID: 'y'
    });
    
    charts.ohlcvChart.update();
  } catch (error) {
    console.error('戦略シグナルデータの取得に失敗しました:', error);
  }
}
```

## 実装スケジュール

1. フィルター機能のHTML追加
2. Chart.js拡張プラグイン（chartjs-chart-financial）の追加
3. ローソク足チャート表示の復元
4. フィルター機能の実装
5. 期間連動機能の実装

## 実装検証とテスト計画

### 1. 各機能の動作検証

以下の点を確認して、実装した機能が正しく動作することを検証します：

1. **ローソク足チャート表示**
   - Chart.js拡張プラグインが正しく読み込まれているか
   - ローソク足チャートが正しく初期化されているか
   - エラーが発生していないか（コンソールでエラーがないことを確認）

2. **フィルター機能**
   - 取引所選択肢が正しく読み込まれるか
   - 取引所を選択すると対応する銘柄選択肢が更新されるか
   - 戦略選択肢が正しく読み込まれるか
   - フィルター適用ボタンで正しくデータがフィルタリングされるか
   - リセットボタンで選択がクリアされ、データが再読み込みされるか

3. **期間選択連動**
   - 各期間ボタン（日次、週次、月次、全期間）をクリックすると
     - ローソク足チャートの期間が変更されるか
     - 戦略シグナルデータの期間が変更されるか

4. **データ表示**
   - OHLCVデータが正しく表示されるか
   - 戦略シグナルが正しくマーカーとして表示されるか（買いは緑、売りは赤）

### 2. エラー処理の検証

以下のエラーケースをテストし、適切に処理されることを確認します：

1. **データなしの場合**
   - 選択した取引所/銘柄/戦略の組み合わせでデータがない場合に適切なメッセージが表示されるか

2. **APIエラーの場合**
   - サーバーエラーが発生した場合に適切なエラーメッセージが表示されるか

3. **戦略シグナルデータのフォーマットエラー**
   - 戦略シグナルデータのレスポンスフォーマットが変更された場合のエラーハンドリングを確認

### 3. パフォーマンス検証

1. **データ読み込み速度**
   - 大量のデータ（例：1年分のOHLCVデータ）でもスムーズに表示されるか
   - フィルター適用時のレスポンス時間は許容範囲内か

2. **メモリ使用量**
   - チャート表示時のメモリ使用量が過剰にならないか

## 潜在的な問題点と解決策

### 1. 戦略シグナルデータの処理
現在のコードではデータ判定処理に潜在的な問題があります：

```javascript
if (!data || data.length === 0) {
  console.warn('戦略シグナルデータがありません');
  return;
}

// その後にdata.dataにアクセスしている
const signalData = data.data.map(item => ({...}));
```

もしAPIレスポンスのフォーマットが異なる場合、`data.data`が存在しないことでエラーが発生する可能性があります。

**解決策**:
```javascript
if (!data || !data.data || data.data.length === 0) {
  console.warn('戦略シグナルデータがありません');
  return;
}
```

### 2. フィルター初期化の重複
現在のコードではフィルターの初期化が重複して行われている可能性があります：

**解決策**:
DOMContentLoadedイベントリスナー内でloadFilterOptions()を呼び出し、グローバルスコープでの呼び出しを削除する。

### 3. フィルター適用時のUX
フィルター適用ボタンのクリック後にデータ取得中であることをユーザーに通知する機能がありません。

**解決策**:
フィルター適用時にローディングインジケーターを表示し、データ取得完了後に非表示にする。

```javascript
applyFilterBtn.addEventListener('click', () => {
  // ローディングインジケーターを表示
  document.getElementById('loading-indicator').classList.remove('d-none');
  
  Promise.all([
    loadOhlcvData(),
    loadStrategySignalDataForChart()
  ]).finally(() => {
    // ローディングインジケーターを非表示
    document.getElementById('loading-indicator').classList.add('d-none');
  });
});
```

## 将来の改善計画

1. **インタラクティブな分析機能の追加**
   - チャート上でのズーム機能
   - 任意の期間選択のためのデイトピッカー追加
   - タッチ/マウスイベントによるチャート操作の最適化

2. **高度なテクニカル指標の追加**
   - 移動平均線、RSI、MACDなどの指標をローソク足チャートにオーバーレイ表示する
   - ユーザーが表示する指標を選択できるインターフェースの追加

3. **データエクスポート機能**
   - チャートデータをCSV形式でエクスポートする機能
   - チャート画像の保存機能

4. **モバイル対応の強化**
   - スマートフォンやタブレットでの表示最適化
   - タッチインターフェースの改善

## 期待される結果

- エラーが解消され、ローソク足チャートが正常に表示される
- 取引所・銘柄・戦略を選択してチャートをフィルタリングできる
- 期間選択（日次、全期間など）に連動して表示期間が変更される
- 戦略シグナルがチャート上に適切に表示される
- ユーザーは直感的にデータを分析できるようになる