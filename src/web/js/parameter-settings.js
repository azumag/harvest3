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
        const parts = paramKey.split(':');
        if (parts.length === 4 && parts[0] === 'params') {
          const exchangeId = parts[1];
          const symbol = parts[2];
          const strategyKey = parts[3];

          if (!bySymbol[exchangeId]) bySymbol[exchangeId] = {};
          if (!bySymbol[exchangeId][symbol]) bySymbol[exchangeId][symbol] = {};
          bySymbol[exchangeId][symbol][strategyKey] = params;

          if (!byStrategy[exchangeId]) byStrategy[exchangeId] = {};
          if (!byStrategy[exchangeId][strategyKey]) byStrategy[exchangeId][strategyKey] = {};
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
            const symbolParams = bySymbol[exchangeId][symbol];
            const collapseId = `collapse-symbol-${exchangeId}-${symbol.replace(/[^a-zA-Z0-9]/g, '-')}`; // Collapse IDに使用可能な文字に変換

            // カードコンテナ (銘柄ごと)
            const card = document.createElement('div');
            card.className = 'card mb-3';
            symbolContainer.appendChild(card);

            // カードヘッダー (Collapseトリガー)
            const cardHeader = document.createElement('div');
            cardHeader.className = 'card-header';
            card.appendChild(cardHeader);

            const headerButton = document.createElement('button');
            headerButton.className = 'btn btn-link text-decoration-none w-100 text-start collapsed'; // collapsedクラスを初期状態で追加
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

            for (const strategyKey in symbolParams) {
              if (symbolParams.hasOwnProperty(strategyKey)) {
                const params = symbolParams[strategyKey];
                // 個別の戦略パラメータセットをカードとして表示
                const strategyCard = document.createElement('div');
                strategyCard.className = 'card mb-2'; // 各戦略カード間のマージン
                cardBody.appendChild(strategyCard);

                const strategyCardBody = document.createElement('div');
                strategyCardBody.className = 'card-body p-3'; // 内側のカードボディのパディング
                strategyCard.appendChild(strategyCardBody);

                // 戦略キーのヘッダー
                const strategyHeader = document.createElement('h6');
                strategyHeader.textContent = `${strategyKey}`;
                strategyHeader.className = 'card-title mb-3'; // カードタイトルスタイル
                strategyCardBody.appendChild(strategyHeader);

                // パラメータフォームを表示
                displayParameterForm(exchangeId, symbol, strategyKey, params, strategyCardBody, 'symbol');
              }
            }
          }
        }
      }
    }


    // 戦略別タブの表示
    for (const exchangeId in byStrategy) {
      if (byStrategy.hasOwnProperty(exchangeId)) {
        for (const strategyKey in byStrategy[exchangeId]) {
          if (byStrategy[exchangeId].hasOwnProperty(strategyKey)) {
            const strategyParams = byStrategy[exchangeId][strategyKey];
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
            headerButton.className = 'btn btn-link text-decoration-none w-100 text-start collapsed'; // collapsedクラスを初期状態で追加
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

            for (const symbol in strategyParams) {
              if (strategyParams.hasOwnProperty(symbol)) {
                const params = strategyParams[symbol];
                // 個別の銘柄パラメータセットをカードとして表示
                const symbolCard = document.createElement('div');
                symbolCard.className = 'card mb-2'; // 各銘柄カード間のマージン
                cardBody.appendChild(symbolCard);

                const symbolCardBody = document.createElement('div');
                symbolCardBody.className = 'card-body p-3'; // 内側のカードボディのパディング
                symbolCard.appendChild(symbolCardBody);

                // 銘柄のヘッダー
                const symbolHeader = document.createElement('h6');
                symbolHeader.textContent = `${symbol}`;
                symbolHeader.className = 'card-title mb-3'; // カードタイトルスタイル
                symbolCardBody.appendChild(symbolHeader);

                // パラメータフォームを表示
                displayParameterForm(exchangeId, symbol, strategyKey, params, symbolCardBody, 'strategy');
              }
            }
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
}

/**
 * パラメータのフォームを表示する
 * @param {string} exchangeId - 取引所ID
 * @param {string} symbol - 銘柄
 * @param {string} strategyKey - 戦略キー
 * @param {Object} params - パラメータオブジェクト
 * @param {HTMLElement} containerElement - 表示先のコンテナ要素
 * @param {string} viewType - 表示タイプ ('symbol' または 'strategy')
 */
function displayParameterForm(exchangeId, symbol, strategyKey, params, containerElement, viewType = 'symbol') {
  // パラメータをグローバル変数に保存
  const paramKey = `${exchangeId}:${symbol}:${strategyKey}`;
  currentParams[paramKey] = { ...params };

  // パラメータフォームを作成
  const formContainer = document.createElement('div'); // パラメータフォームのコンテナ
  formContainer.setAttribute('data-param-key', paramKey);

  // パラメータの名前を配列として取得
  const paramNames = Object.keys(params);

  // テーブル形式でフォームを作成
  let formContent = `
    <form id="form-${paramKey}">
      <div class="table-responsive">
        <table class="table table-sm table-bordered">
          <thead>
            <tr>
              <th>${viewType === 'symbol' ? '戦略' : '銘柄'}</th>
  `;

  // パラメータ名をテーブルヘッダーに追加
  paramNames.forEach(paramName => {
    formContent += `<th>${paramName}</th>`;
  });

  formContent += `
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${viewType === 'symbol' ? strategyKey : symbol}</td>
  `;

  // パラメータ値をテーブルセルに追加
  paramNames.forEach(paramName => {
    const paramValue = params[paramName];
    formContent += `<td>${createInputField(paramName, paramValue, paramKey)}</td>`;
  });

  formContent += `
            </tr>
          </tbody>
        </table>
      </div>
    </form>
  `;

  formContainer.innerHTML = formContent;
  containerElement.appendChild(formContainer);

  // フォームフィールドの変更イベントリスナーを設定
  const form = document.getElementById(`form-${paramKey}`);
  form.addEventListener('change', function(e) {
    const input = e.target;
    if (!input.hasAttribute('data-param-name')) return;

    const paramName = input.getAttribute('data-param-name');
    const paramKey = input.closest('form').id.substring(5); // "form-"の5文字を除去

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
       } catch (e) {
        // JSONパースに失敗した場合は文字列として扱う
       }
    }

    modifiedParams[paramKey][paramName] = value;

    // 保存ボタンを有効化
    document.getElementById('save-btn').disabled = false;
  });
}

/**
 * 入力フィールドのHTMLを生成
 * @param {string} paramName - パラメータ名
 * @param {any} paramValue - パラメータ値
 * @param {string} paramKey - パラメータキー（exchange:symbol:strategy）
 * @returns {string} HTML文字列
 */
function createInputField(paramName, paramValue, paramKey) {
  const type = typeof paramValue;
  let inputHtml = '';

  if (type === 'boolean') {
    // 真偽値の場合はチェックボックス
    inputHtml = `
      <div class="form-check">
        <input type="checkbox" class="form-check-input" id="${paramKey}-${paramName}"
               ${paramValue ? 'checked' : ''} data-param-name="${paramName}">
        <label class="form-check-label" for="${paramKey}-${paramName}">有効</label>
      </div>
    `;
  } else if (type === 'number') {
    // 数値の場合は数値入力フィールド
    inputHtml = `
      <input type="number" class="form-control form-control-sm" id="${paramKey}-${paramName}"
             value="${paramValue}" step="any" data-param-name="${paramName}">
    `;
  } else if (type === 'object' && paramValue !== null) {
    // オブジェクトまたは配列の場合はJSON表示
    const jsonValue = JSON.stringify(paramValue, null, 2);
    inputHtml = `
      <textarea class="form-control" id="${paramKey}-${paramName}"
               rows="2" data-param-name="${paramName}">${jsonValue}</textarea>
    `;
  } else {
    // その他（文字列など）はテキスト入力フィールド
    inputHtml = `
      <input type="text" class="form-control form-control-sm" id="${paramKey}-${paramName}"
             value="${paramValue !== null ? paramValue : ''}" data-param-name="${paramName}">
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

    // 変更された各パラメータセットを保存
    for (const [paramKey, params] of Object.entries(modifiedParams)) {
      const [exchangeId, symbol, strategyKey] = paramKey.split(':');

      // 現在のパラメータとマージ
      const mergedParams = { ...currentParams[paramKey], ...params };

      try {
        const response = await fetch('/api/parameters', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            exchangeId,
            symbol,  // POSTリクエストのボディではエンコード不要
            strategyKey,
            params: mergedParams
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'パラメータの保存に失敗しました');
        }

        // 保存成功時は現在のパラメータを更新
        currentParams[paramKey] = { ...mergedParams };

        successCount++;
      } catch (error) {
        console.error(`${exchangeId}:${symbol}:${strategyKey}のパラメータ保存中にエラーが発生:`, error);
        errorCount++;
        errorDetails.push(`${exchangeId}:${symbol}:${strategyKey} - ${error.message}`);
      }
    }

    // 保存結果のフィードバック
    if (errorCount === 0) {
      showFeedback(`${successCount}件のパラメータセットが正常に保存されました。`, 'success');

      // 変更追跡をリセット
      modifiedParams = {};

      // 保存ボタンを無効化
      document.getElementById('save-btn').disabled = true;
    } else if (successCount > 0) {
      showFeedback(`${successCount}件のパラメータセットが保存されましたが、${errorCount}件で保存中にエラーが発生しました。<br>${errorDetails.join('<br>')}`, 'warning');
    } else {
      showFeedback(`すべてのパラメータの保存に失敗しました。<br>${errorDetails.join('<br>')}`, 'danger');
    }

    hideLoading();
  } catch (error) {
    console.error('パラメータの保存中にエラーが発生しました:', error);
    showFeedback('エラー: パラメータの保存に失敗しました。', 'danger');
    hideLoading();
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

  // 5秒後に自動的に閉じる
  setTimeout(() => {
    if (alert.parentNode) {
      alert.classList.remove('show');
      setTimeout(() => {
        if (alert.parentNode) {
          alert.remove();
        }
      }, 150);
    }
  }, 5000);
}