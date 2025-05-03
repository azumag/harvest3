# パラメータセットに基づく分析画面改善設計書

## 1. 概要

現在の分析画面では、ユーザーが「パラメータセット」「取引所」「銘柄」「時間足」「表示数」を個別に選択する必要があります。この設計では、「パラメータセット」のみを選択すれば自動的に適切な取引所、銘柄、時間足が設定されるよう改善します。

## 2. 現状の課題

- ユーザーが複数の設定項目を個別に選択する必要がある
- パラメータセットに含まれる情報と重複した設定を行っている
- ユーザーが設定間の整合性を意識する必要がある

## 3. 改善方針

### 3.1 廃止するコンポーネント
- 取引所ドロップダウン
- 銘柄ドロップダウン
- 時間足ドロップダウン
- 表示数ドロップダウン

### 3.2 自動判別ロジック

#### 取引所と銘柄の判定
パラメータセット名から取引所と銘柄を抽出します。
例: `binance_BTCUSDT_strategy1` → 取引所: `binance`, 銘柄: `BTCUSDT`

既存の実装（parameters.js）から参照する抽出方法:
```javascript
// パラメータセットのキー形式: params:取引所:銘柄:戦略名
const parts = paramKey.split(':');
if (parts.length === 4 && parts[0] === 'params') {
    const exchangeId = parts[1];
    const symbol = parts[2];
    const strategyKey = parts[3];
    
    // パラメータセット名を作成
    const setName = `${exchangeId}:${symbol}:${strategyKey}`;
}
```

#### 時間足の判定
1. パラメータ内に `ohlcvInterval` がある場合、それをロウソク足の timeframe として利用
2. 存在しない場合はデフォルトで "1h" を使用

```javascript
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
```

#### 表示数（limit）の判定
1. パラメータ内に `period` という項目が存在する場合はその値を limit に使用
2. 存在しない場合、`period` という名前を含む項目（例: `slow_period`, `fast_period`, `Period`, `PERIOD`）の中で最大の数値を使用
3. 適切な値が見つからない場合は100などのデフォルト値を使用

```javascript
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
```

## 4. 実装詳細

### 4.1 HTMLの変更
- 不要なドロップダウンを削除
- パラメータセットの選択結果を表示するための領域を追加

```html
<!-- 変更前 -->
<div class="form-group">
    <label for="filter-exchange">取引所</label>
    <select class="form-control" id="filter-exchange">
        <option value="">取引所を選択</option>
    </select>
</div>
<div class="form-group">
    <label for="filter-symbol">銘柄</label>
    <select class="form-control" id="filter-symbol" disabled>
        <option value="">銘柄を選択</option>
    </select>
</div>
<!-- その他のドロップダウン -->

<!-- 変更後 -->
<div class="form-group">
    <label for="filter-parameter-set">パラメータセット</label>
    <select class="form-control" id="filter-parameter-set">
        <option value="">パラメータセットを選択</option>
    </select>
</div>
<div id="parameter-info" class="mt-3">
    <div class="alert alert-info">
        <p><strong>選択情報:</strong></p>
        <p>取引所: <span id="selected-exchange">未選択</span></p>
        <p>銘柄: <span id="selected-symbol">未選択</span></p>
        <p>時間足: <span id="selected-timeframe">自動設定</span></p>
        <p>表示数: <span id="selected-limit">自動設定</span></p>
    </div>
</div>
```

### 4.2 JavaScriptの変更
- パラメータセットから情報を抽出する関数の実装
- 表示ボタンクリック時のハンドリング修正
- チャート表示ロジックの修正
  - 基準日については現在時刻を利用

```javascript
/**
 * パラメータセットを読み込み、セレクトボックスに表示する
 */
async function loadParameterSets() {
    try {
        showLoading(true);
        
        const response = await fetch('/api/all-parameters');
        
        if (!response.ok) {
            throw new Error('パラメータセットの取得に失敗しました');
        }
        
        const allParameters = await response.json();
        const parameterSetSelect = document.getElementById('filter-parameter-set');
        
        // セレクトボックスをクリア
        parameterSetSelect.innerHTML = '<option value="">パラメータセットを選択</option>';
        
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
                    
                    // パラメータセット名を作成
                    const setName = `${exchangeId}:${symbol}:${strategyKey}`;
                    const displayName = `${exchangeId} - ${symbol} - ${strategyKey}`;
                    
                    if (!parameterSets.has(setName)) {
                        parameterSets.set(setName, {
                            displayName,
                            exchange: exchangeId,
                            symbol: symbol,
                            strategy: strategyKey,
                            params: allParameters[paramKey]
                        });
                    }
                }
            }
        }
        
        // セレクトボックスにオプションを追加（アルファベット順にソート）
        const sortedSets = new Map([...parameterSets].sort((a, b) => a[1].displayName.localeCompare(b[1].displayName)));
        
        for (const [value, info] of sortedSets) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = info.displayName;
            // データ属性に情報を保存
            option.dataset.exchange = info.exchange;
            option.dataset.symbol = info.symbol;
            option.dataset.strategy = info.strategy;
            parameterSetSelect.appendChild(option);
        }
        
        showLoading(false);
    } catch (error) {
        console.error('パラメータセットの読み込み中にエラーが発生しました:', error);
        showError('パラメータセットの読み込みに失敗しました');
        showLoading(false);
    }
}

/**
 * パラメータセット選択時に自動的に設定値を更新
 */
function handleParameterSetChange() {
    const select = document.getElementById('filter-parameter-set');
    const selectedOption = select.options[select.selectedIndex];
    
    if (select.value) {
        // 選択されたオプションからデータを取得
        const exchange = selectedOption.dataset.exchange;
        const symbol = selectedOption.dataset.symbol;
        const strategy = selectedOption.dataset.strategy;
        
        // 情報表示を更新
        document.getElementById('selected-exchange').textContent = exchange;
        document.getElementById('selected-symbol').textContent = symbol;
        
        // パラメータセットの詳細を取得してtimeframeとlimitを判定
        fetchParameterDetails(exchange, symbol, strategy);
    } else {
        // 未選択状態にリセット
        document.getElementById('selected-exchange').textContent = '未選択';
        document.getElementById('selected-symbol').textContent = '未選択';
        document.getElementById('selected-timeframe').textContent = '自動設定';
        document.getElementById('selected-limit').textContent = '自動設定';
    }
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

/**
 * データを取得してチャートを描画（更新版）
 */
async function fetchDataAndRenderChart() {
    const parameterSetSelect = document.getElementById('filter-parameter-set');
    const selectedOption = parameterSetSelect.options[parameterSetSelect.selectedIndex];
    
    if (!parameterSetSelect.value) {
        showError('パラメータセットを選択してください');
        return;
    }
    
    // 選択されたパラメータセットからデータを取得
    const exchange = selectedOption.dataset.exchange;
    const symbol = selectedOption.dataset.symbol;
    const strategy = selectedOption.dataset.strategy;
    
    // 時間足と表示数は表示されている値を使用
    const timeframe = document.getElementById('selected-timeframe').textContent;
    const limit = document.getElementById('selected-limit').textContent;
    
    // 日付はデフォルトで現在時刻を使用
    const startDate = document.getElementById('filter-start-date').value || formatDate(new Date());
    
    // ローディング表示
    showLoading(true);
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
            showLoading(false);
            return;
        }
        
        renderChart(ohlcvData, signalData);
        showNoDataMessage(false);
    } catch (error) {
        console.error('データ取得中にエラーが発生しました:', error);
        showError('データの取得に失敗しました。入力条件を確認してください。');
    } finally {
        showLoading(false);
    }
}
```

## 5. メリット
- ユーザー操作が簡略化される
- 設定の一貫性が保証される
- 操作ステップの削減によるUX向上

## 6. ステップバイステップの実装手順

1. **HTMLの修正**
   - `analysis.html` から不要なドロップダウン（取引所、銘柄、時間足、表示数）を削除
   - パラメータセット選択用のドロップダウンを追加または修正
   - 選択情報表示用の領域を追加

2. **パラメータ取得APIの確認**
   - `/api/all-parameters` エンドポイントが正しく動作することを確認
   - 必要に応じてパラメータ取得APIを修正または拡張

3. **JavaScriptの修正**
   - `loadParameterSets()` 関数を実装または修正
   - パラメータセットから情報を抽出する関数を実装
   - `handleParameterSetChange()` イベントハンドラを実装
   - `fetchDataAndRenderChart()` 関数を修正

4. **テストとデバッグ**
   - さまざまなパラメータセットでパラメータ抽出が正しく動作することを確認
   - 時間足の判定ロジックが正しく機能することを確認
   - チャートがパラメータセットの選択に基づいて正しく表示されることを確認

5. **UI微調整とユーザビリティの向上**
   - 選択情報の表示を見やすく整える
   - エラーメッセージを改善
   - ローディングインジケータの表示を改善

## 7. テスト項目

- 様々な命名規則のパラメータセットで正しく情報が抽出できるか
- 時間足の判定が正しく行われるか
- エラー処理が適切に行われるか
- UIの視認性と使いやすさ
