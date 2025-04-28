/**
 * 戦略パラメータ設定ページのJavaScript
 */

// グローバル変数
let currentParams = {}; // 現在表示中のパラメータ
let modifiedParams = {}; // 変更されたパラメータ
let activeTab = 'by-symbol'; // アクティブなタブ

// DOMが読み込まれたら実行
document.addEventListener('DOMContentLoaded', () => {
  // 初期化
  loadAllParameters(); // 全パラメータを読み込むように変更
  setupEventListeners();
});

/**
 * 全ての戦略パラメータを読み込む
 * BootstrapのCollapseコンポーネントを使用して銘柄別/戦略別に折りたたみ表示を実装
 */
async function loadAllParameters() {
  try {
    showLoading();

    const response = await fetch('/api/all-parameters');

    if (!response.ok) {
      throw new Error('全パラメータの取得に失敗しました');
    }

    const allParameters = await response.json();

    const symbolContainer = document.getElementById('by-symbol');
    const strategyContainer = document.getElementById('by-strategy');
    symbolContainer.innerHTML = ''; // コンテナをクリア
    strategyContainer.innerHTML = ''; // コンテナをクリア

    let hasParameters = false;

    // パラメータを銘柄別、戦略別に整理
    const bySymbol = {};
    const byStrategy = {};

    for (const paramKey in allParameters) {
      if (allParameters.hasOwnProperty(paramKey)) {
        const params = allParameters[paramKey];
        // グローバル変数に初期パラメータを保存
        currentParams[paramKey] = { ...params };
        const parts = paramKey.split(':');
        if (parts.length === 4 && parts[0] === 'params') {
          const exchangeId = parts[1];
          const symbol = parts[2];
          const strategyKey = parts[3];

          if (!bySymbol[exchangeId]) bySymbol[exchangeId] = {};
          if (!bySymbol[exchangeId][symbol]) bySymbol[exchangeId][symbol] = {};
          if (!bySymbol[exchangeId][symbol][strategyKey]) bySymbol[exchangeId][symbol][strategyKey] = {};
          bySymbol[exchangeId][symbol][strategyKey] = params;

          if (!byStrategy[exchangeId]) byStrategy[exchangeId] = {};
          if (!byStrategy[exchangeId][strategyKey]) byStrategy[exchangeId][strategyKey] = {};
          if (!byStrategy[exchangeId][strategyKey][symbol]) byStrategy[exchangeId][strategyKey][symbol] = {};
          byStrategy[exchangeId][strategyKey][symbol] = params;

          hasParameters = true;
        } else {
          console.warn(`不正なパラメータキー形式が見つかりました: ${paramKey}`);
        }
      }
    }

    // 銘柄別タブの表示
    for (const exchangeId in bySymbol) {
      if (bySymbol.hasOwnProperty(exchangeId)) {
        for (const symbol in bySymbol[exchangeId]) {
          if (bySymbol[exchangeId].hasOwnProperty(symbol)) {
            const strategyParamsMap = bySymbol[exchangeId][symbol]; // この銘柄の全戦略パラメータ
            const collapseId = `collapse-symbol-${exchangeId}-${symbol.replace(/[^a-zA-Z0-9]/g, '-')}`;

            // カードコンテナ (銘柄ごと)
            const card = document.createElement('div');
            card.className = 'card mb-3';
            symbolContainer.appendChild(card);

            // カードヘッダー (Collapseトリガー)
            const cardHeader = document.createElement('div');
            cardHeader.className = 'card-header';
            card.appendChild(cardHeader);

            const headerButton = document.createElement('button');
            headerButton.className = 'btn btn-link text-decoration-none w-100 text-start collapsed';
            headerButton.type = 'button';
            headerButton.setAttribute('data-bs-toggle', 'collapse');
            headerButton.setAttribute('data-bs-target', `#${collapseId}`);
            headerButton.setAttribute('aria-expanded', 'false');
            headerButton.setAttribute('aria-controls', collapseId);
            headerButton.textContent = `${exchangeId} - ${symbol}`;
            cardHeader.appendChild(headerButton);

            // Collapse コンテンツ (カードボディ)
            const collapseDiv = document.createElement('div');
            collapseDiv.className = 'collapse';
            collapseDiv.id = collapseId;
            card.appendChild(collapseDiv);

            const cardBody = document.createElement('div');
            cardBody.className = 'card-body';
            collapseDiv.appendChild(cardBody);

            // パラメータテーブルを表示
            displayParameterTable(exchangeId, symbol, null, strategyParamsMap, cardBody, 'symbol');
          }
        }
      }
    }


    // 戦略別タブの表示
    for (const exchangeId in byStrategy) {
      if (byStrategy.hasOwnProperty(exchangeId)) {
        for (const strategyKey in byStrategy[exchangeId]) {
          if (byStrategy[exchangeId].hasOwnProperty(strategyKey)) {
            const symbolParamsMap = byStrategy[exchangeId][strategyKey]; // この戦略の全銘柄パラメータ
            const collapseId = `collapse-strategy-${exchangeId}-${strategyKey}`;

            // カードコンテナ (戦略ごと)
            const card = document.createElement('div');
            card.className = 'card mb-3';
            strategyContainer.appendChild(card);

            // カードヘッダー (Collapseトリガー)
            const cardHeader = document.createElement('div');
            cardHeader.className = 'card-header';
            card.appendChild(cardHeader);

            const headerButton = document.createElement('button');
            headerButton.className = 'btn btn-link text-decoration-none w-100 text-start collapsed';
            headerButton.type = 'button';
            headerButton.setAttribute('data-bs-toggle', 'collapse');
            headerButton.setAttribute('data-bs-target', `#${collapseId}`);
            headerButton.setAttribute('aria-expanded', 'false');
            headerButton.setAttribute('aria-controls', collapseId);
            headerButton.textContent = `${exchangeId} - ${strategyKey}`;
            cardHeader.appendChild(headerButton);

            // Collapse コンテンツ (カードボディ)
            const collapseDiv = document.createElement('div');
            collapseDiv.className = 'collapse';
            collapseDiv.id = collapseId;
            card.appendChild(collapseDiv);

            const cardBody = document.createElement('div');
            cardBody.className = 'card-body';
            collapseDiv.appendChild(cardBody);

            // パラメータテーブルを表示
            displayParameterTable(exchangeId, null, strategyKey, symbolParamsMap, cardBody, 'strategy');
          }
        }
      }
    }


    if (!hasParameters) {
      symbolContainer.innerHTML = '<p class="text-muted">パラメータが設定されている取引所、銘柄、戦略の組み合わせはありません。</p>';
      strategyContainer.innerHTML = '<p class="text-muted">パラメータが設定されている取引所、銘柄、戦略の組み合わせはありません。</p>';
    }

    hideLoading();
  } catch (error) {
    console.error('全パラメータの読み込み中にエラーが発生しました:', error);
    showFeedback('エラー: 全パラメータの読み込みに失敗しました。', 'danger');
    hideLoading();
  }
}


/**
 * イベントリスナーの設定
 */
function setupEventListeners() {
  // タブ切り替え時
  document.querySelectorAll('#paramTabs button').forEach(tab => {
    tab.addEventListener('click', function() {
      // アクティブなタブを更新
      activeTab = this.getAttribute('data-bs-target').substring(1);
    });
  });

  // 保存ボタンクリック時
  document.getElementById('save-btn').addEventListener('click', saveParameters);

  // パラメータ変更時のイベントリスナー (イベント委譲を使用)
  document.getElementById('paramTabsContent').addEventListener('change', function(e) {
    const input = e.target;
    // data-param-key と data-param-name を持つ要素のみを対象とする
    if (!input.matches('[data-param-key][data-param-name]')) return;

    const paramKey = input.getAttribute('data-param-key');
    const paramName = input.getAttribute('data-param-name');

    // 変更されたパラメータを追跡
    if (!modifiedParams[paramKey]) {
      modifiedParams[paramKey] = {};
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

    modifiedParams[paramKey][paramName] = value;

    // 保存ボタンを有効化
    document.getElementById('save-btn').disabled = false;
  });
}


/**
 * パラメータのテーブルを表示する
 * @param {string} exchangeId - 取引所ID
 * @param {string | null} symbol - 銘柄 (viewType='symbol'の場合)
 * @param {string | null} strategyKey - 戦略キー (viewType='strategy'の場合)
 * @param {Object} paramsMap - パラメータオブジェクトのマップ { rowKey: params }
 * @param {HTMLElement} containerElement - 表示先のコンテナ要素
 * @param {string} viewType - 表示タイプ ('symbol' または 'strategy')
 */
function displayParameterTable(exchangeId, symbol, strategyKey, paramsMap, containerElement, viewType) {
  const formId = `form-${viewType}-${exchangeId}-${(symbol || strategyKey).replace(/[^a-zA-Z0-9]/g, '-')}`;
  const rowIdentifierHeader = viewType === 'symbol' ? '戦略' : '銘柄';

  // 全てのパラメータ名を取得し、ユニークにする
  const allParamNames = new Set();
  Object.values(paramsMap).forEach(params => {
    Object.keys(params).forEach(name => allParamNames.add(name));
  });
  const sortedParamNames = Array.from(allParamNames).sort(); // パラメータ名をソート
  const paramCount = sortedParamNames.length;

  // テーブルHTMLを生成
  let tableHtml = `
    <form id="${formId}">
      <div class="table-responsive">
        <table class="table table-sm table-bordered table-hover" style="width: 100%; table-layout: fixed;">
          <thead class="table-light">
            <tr>
              <th style="width: 15%;" data-bs-toggle="tooltip" data-bs-placement="top" title="${rowIdentifierHeader}">${rowIdentifierHeader}</th>
  `;

  // パラメータ名をテーブルヘッダーに追加
  const columnWidth = paramCount > 0 ? Math.max(85 / paramCount, 8) : 10; // 最低でも8%の幅を確保

  sortedParamNames.forEach(paramName => {
    // ヘッダーセルに data-bs-toggle と data-bs-placement を追加
    tableHtml += `<th style="width: ${columnWidth}%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" data-bs-toggle="tooltip" data-bs-placement="top" title="${paramName}">${paramName}</th>`;
  });

  tableHtml += `
            </tr>
          </thead>
          <tbody>
  `;

  // 各行（戦略または銘柄）を生成
  for (const rowKey in paramsMap) {
    if (paramsMap.hasOwnProperty(rowKey)) {
      const params = paramsMap[rowKey];
      const currentSymbol = viewType === 'symbol' ? symbol : rowKey;
      const currentStrategyKey = viewType === 'symbol' ? rowKey : strategyKey;
      const paramKey = `params:${exchangeId}:${currentSymbol}:${currentStrategyKey}`;

      // 最初のセルに data-bs-toggle と data-bs-placement を追加
      tableHtml += `<tr><td class="align-middle" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" data-bs-toggle="tooltip" data-bs-placement="top" title="${rowKey}">${rowKey}</td>`;

      // 各パラメータの入力フィールドを生成
      sortedParamNames.forEach(paramName => {
        const paramValue = params.hasOwnProperty(paramName) ? params[paramName] : undefined; // パラメータが存在しない場合
        // セルのパディングを完全に削除
        tableHtml += `<td class="p-0 align-middle">`;
        if (paramValue !== undefined) {
          tableHtml += createInputField(paramName, paramValue, paramKey);
        } else {
          tableHtml += `<span class="text-muted d-block text-center">-</span>`; // 中央揃え
        }
        tableHtml += `</td>`;
      });

      tableHtml += `</tr>`;
    }
  }

  tableHtml += `
          </tbody>
        </table>
      </div>
    </form>
  `;

  containerElement.innerHTML = tableHtml;

  // Bootstrap ツールチップの初期化
  const tooltipTriggerList = [].slice.call(containerElement.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    // ツールチップのオプションでHTMLを許可する (必要に応じて)
    // return new bootstrap.Tooltip(tooltipTriggerEl, { html: true });
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });
}


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
 * パラメータを保存する
 */
async function saveParameters() {
  if (Object.keys(modifiedParams).length === 0) {
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
    for (const [paramKey, changedValues] of Object.entries(modifiedParams)) {
      const [prefix, exchangeId, symbol, strategyKey] = paramKey.split(':');
      if (prefix !== 'params') continue; // キー形式チェック

      // 現在のパラメータと変更された値をマージ
      // currentParams[paramKey] が存在しない場合も考慮 (念のため)
      const baseParams = currentParams[paramKey] || {};
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
        currentParams[paramKey] = { ...mergedParams };
        updatedParamKeys.add(paramKey); // 更新されたキーを追加
        successCount++;
      } catch (error) {
        console.error(`${paramKey} のパラメータ保存中にエラーが発生:`, error);
        errorCount++;
        errorDetails.push(`${exchangeId}:${symbol}:${strategyKey} - ${error.message}`);
      }
    }

    // modifiedParamsから正常に更新されたキーを削除
    updatedParamKeys.forEach(key => {
      delete modifiedParams[key];
    });

    // 保存結果のフィードバック
    let message = '';
    let type = 'info';

    if (errorCount === 0) {
      message = `${successCount} 件のパラメータセットが正常に保存されました。`;
      type = 'success';
      // 変更追跡をリセット (エラーがなければ空のはず)
      modifiedParams = {};
      // 保存ボタンを無効化
      document.getElementById('save-btn').disabled = true;
    } else if (successCount > 0) {
      message = `${successCount} 件のパラメータセットが保存されましたが、${errorCount} 件でエラーが発生しました。<br>${errorDetails.join('<br>')}`;
      type = 'warning';
       // エラーが残っている場合は保存ボタンを有効のままにする
       document.getElementById('save-btn').disabled = false;
    } else {
      message = `すべてのパラメータ (${errorCount}件) の保存に失敗しました。<br>${errorDetails.join('<br>')}`;
      type = 'danger';
       // エラーが残っている場合は保存ボタンを有効のままにする
       document.getElementById('save-btn').disabled = false;
    }
    showFeedback(message, type);

    hideLoading();
  } catch (error) {
    console.error('パラメータの保存処理全体でエラーが発生しました:', error);
    showFeedback('エラー: パラメータの保存処理中に予期せぬエラーが発生しました。', 'danger');
    hideLoading();
     // 予期せぬエラーの場合もボタンは有効のままにする
     document.getElementById('save-btn').disabled = false;
  }
}

/**
 * パラメータ表示をクリアする (この関数はもう使用されないが、念のため残しておくか、削除を検討)
 */
function clearParamsDisplay() {
  // フィルタがなくなったため、この関数は不要になる可能性が高い
  // 必要に応じて削除または修正
  document.getElementById('by-symbol').innerHTML = '<p class="text-muted">パラメータを読み込み中...</p>';
  document.getElementById('by-strategy').innerHTML = '<p class="text-muted">パラメータを読み込み中...</p>';
  document.getElementById('save-btn').disabled = true;

  // 変更追跡をリセット
  modifiedParams = {};
}


/**
 * ローディング表示の表示
 */
function showLoading() {
  document.getElementById('loading-overlay').classList.remove('d-none');
}

/**
 * ローディング表示の非表示
 */
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('d-none');
}

/**
 * フィードバックの表示
 * @param {string} message - 表示するメッセージ
 * @param {string} type - アラートタイプ（success, danger, warning, info）
 */
function showFeedback(message, type = 'info') {
  const feedbackContainer = document.getElementById('feedback-container');

  // 新しいアラートを作成
  const alert = document.createElement('div');
  alert.className = `alert alert-${type} alert-dismissible fade show`;
  alert.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="閉じる"></button>
  `;

  // 既存のアラートを削除
  feedbackContainer.querySelectorAll('.alert').forEach(existingAlert => {
    existingAlert.remove();
  });

  // 新しいアラートを追加
  feedbackContainer.appendChild(alert);

  // 5秒後に自動的に閉じる (success の場合のみ)
  if (type === 'success') {
      setTimeout(() => {
        if (alert.parentNode) {
          bootstrap.Alert.getOrCreateInstance(alert).close();
        }
      }, 5000);
  }
}