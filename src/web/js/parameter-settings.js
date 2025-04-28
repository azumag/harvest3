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
 */
async function loadAllParameters() {
    try {
        showLoading();

        // 取引所一覧を取得
        const exchangesResponse = await fetch('/api/exchanges');
        const exchanges = await exchangesResponse.json();

        // 戦略一覧を取得
        const strategiesResponse = await fetch('/api/strategies');
        const strategies = await strategiesResponse.json();

        // 各取引所、銘柄、戦略の組み合わせでパラメータを取得して表示
        const symbolContainer = document.getElementById('by-symbol');
        const strategyContainer = document.getElementById('by-strategy');
        symbolContainer.innerHTML = ''; // コンテナをクリア
        strategyContainer.innerHTML = ''; // コンテナをクリア

        let hasParameters = false;

        for (const exchangeId of exchanges) { // exchange を exchangeId に変更
            // 銘柄一覧を取得
            const symbolsResponse = await fetch(`/api/symbols?exchange=${exchangeId}`); // exchangeId を exchange に変更
            
            if (!symbolsResponse.ok) {
                 throw new Error(`${exchangeId} の銘柄一覧取得に失敗しました`);
            }

            const symbols = await symbolsResponse.json();

            // symbols が配列であることを確認
            if (!Array.isArray(symbols)) {
                console.error(`${exchange.id} の銘柄一覧が配列ではありません:`, symbols);
                throw new Error(`${exchange.id} の銘柄一覧の形式が不正です`);
            }

            for (const symbol of symbols) {
                for (const strategyKey of strategies) {
                    try {
                        // symbolをエンコードしてURLに含める
                        const encodedSymbol = encodeURIComponent(symbol);
                        const response = await fetch(`/api/parameters?exchangeId=${exchangeId}&symbol=${encodedSymbol}&strategyKey=${strategyKey}`);
                        
                        if (response.status === 404) {
                            // パラメータが存在しない場合はスキップ
                            continue;
                        }
                        
                        if (!response.ok) {
                            throw new Error(`${exchangeId}:${symbol}:${strategyKey}のパラメータ取得に失敗しました`);
                        }
                        
                        const data = await response.json();
 
                         // 銘柄別タブに表示
                         const symbolHeader = document.createElement('h4');
                         // 取引所名を取得するために、exchanges 配列から対応する取引所オブジェクトを見つける必要がある
                         // ただし、/api/exchanges は ID の配列を返すため、ここでは ID をそのまま使用する
                         symbolHeader.textContent = `${exchangeId} - ${symbol} - ${strategyKey}`; // strategy.name || strategy.key を strategyKey に変更
                         symbolHeader.className = 'mt-4 mb-3';
                         symbolContainer.appendChild(symbolHeader);
                         displayParameterForm(exchangeId, symbol, strategyKey, data.params, symbolContainer);
                         hasParameters = true;
 
                         // 戦略別タブに表示
                         const strategyHeader = document.createElement('h4');
                         strategyHeader.textContent = `${exchangeId} - ${strategyKey} - ${symbol}`; // strategy.name || strategy.key を strategyKey に変更
                         strategyHeader.className = 'mt-4 mb-3';
                         strategyContainer.appendChild(strategyHeader);
                         displayParameterForm(exchangeId, symbol, strategyKey, data.params, strategyContainer);
                         hasParameters = true;
 
                     } catch (error) {
                         console.error(`${exchangeId}:${symbol}:${strategyKey}のパラメータ読み込み中にエラーが発生しました:`, error); // strategy.key を strategyKey に変更
 
                         const errorCard = document.createElement('div');
                         errorCard.className = 'card mb-3 border-danger';
                         errorCard.innerHTML = `
                             <div class="card-body text-danger">
                                 <p>エラー: ${exchangeId}:${symbol}:${strategyKey}のパラメータの読み込みに失敗しました。</p> // strategy.key を strategyKey に変更
                             </div>
                         `;
                         symbolContainer.appendChild(errorCard);
                         strategyContainer.appendChild(errorCard.cloneNode(true)); // 戦略別タブにも同じエラーを表示
                     }
                 }
             }
         }

        if (hasParameters) {
            document.getElementById('save-btn').disabled = false;
        } else {
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
 */
function displayParameterForm(exchangeId, symbol, strategyKey, params, containerElement) {
    // パラメータをグローバル変数に保存
    const paramKey = `${exchangeId}:${symbol}:${strategyKey}`;
    currentParams[paramKey] = { ...params };

    // パラメータフォームを作成
    const formCard = document.createElement('div');
    formCard.className = 'card mb-3 param-card'; // param-card クラスを追加
    formCard.setAttribute('data-param-key', paramKey);

    let formContent = `
        <div class="card-body">
            <form id="form-${paramKey}">
    `;

    // パラメータフィールドを追加
    for (const [key, value] of Object.entries(params)) {
        formContent += createFormField(key, value, paramKey);
    }

    // 新規パラメータ追加ボタン
    formContent += `
                <div class="mb-3 mt-4">
                    <button type="button" class="btn btn-sm btn-outline-primary add-param-field-btn"
                            data-param-key="${paramKey}">
                        パラメータを追加
                    </button>
                </div>
            </form>
        </div>
    `;

    formCard.innerHTML = formContent;
    containerElement.appendChild(formCard);

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

    // 新規パラメータ追加ボタンのイベントリスナー
    const addParamBtn = formCard.querySelector('.add-param-field-btn');
    if (addParamBtn) {
        addParamBtn.addEventListener('click', function() {
            const paramKey = this.getAttribute('data-param-key');
            const form = document.getElementById(`form-${paramKey}`);

            // 新規パラメータ入力フィールドを動的に追加
            const newFieldKey = `newParam${Date.now()}`;
            const newFieldContainer = document.createElement('div');
            newFieldContainer.className = 'mb-3';
            newFieldContainer.innerHTML = `
                <div class="input-group">
                    <input type="text" class="form-control param-name-input" placeholder="パラメータ名" required>
                    <input type="text" class="form-control param-value-input" placeholder="値" required>
                    <button type="button" class="btn btn-outline-danger remove-param-btn">削除</button>
                </div>
            `;

            // 追加ボタンの前に新しいフィールドを挿入
            form.insertBefore(newFieldContainer, this.parentElement);

            // 削除ボタンのイベントリスナー
            newFieldContainer.querySelector('.remove-param-btn').addEventListener('click', function() {
                newFieldContainer.remove();
            });

            // 確定ボタンを追加
            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'button';
            confirmBtn.className = 'btn btn-sm btn-outline-success mt-2';
            confirmBtn.textContent = '確定';
            newFieldContainer.appendChild(confirmBtn);

            // 確定ボタンのイベントリスナー
            confirmBtn.addEventListener('click', function() {
                const nameInput = newFieldContainer.querySelector('.param-name-input');
                const valueInput = newFieldContainer.querySelector('.param-value-input');

                const paramName = nameInput.value.trim();
                let paramValue = valueInput.value.trim();

                // 入力値の検証
                if (!paramName) {
                    alert('パラメータ名を入力してください。');
                    return;
                }

                // 値を適切な型に変換を試みる
                if (paramValue === 'true') {
                    paramValue = true;
                } else if (paramValue === 'false') {
                    paramValue = false;
                } else if (!isNaN(parseFloat(paramValue)) && isFinite(paramValue)) {
                    paramValue = parseFloat(paramValue);
                } else if ((paramValue.startsWith('{') && paramValue.endsWith('}')) ||
                           (paramValue.startsWith('[') && paramValue.endsWith(']'))) {
                    try {
                        paramValue = JSON.parse(paramValue);
                    } catch (e) {
                        // JSONパースに失敗した場合は文字列として扱う
                    }
                }


                // 現在のパラメータに追加
                if (!currentParams[paramKey]) {
                    currentParams[paramKey] = {};
                }
                currentParams[paramKey][paramName] = paramValue;

                // 変更されたパラメータに追加
                if (!modifiedParams[paramKey]) {
                    modifiedParams[paramKey] = {};
                }
                modifiedParams[paramKey][paramName] = paramValue;

                // 一時的なフィールドを削除して正式なフィールドに置き換え
                newFieldContainer.remove();

                // フォームを再表示
                const [exchangeId, symbol, strategyKey] = paramKey.split(':');
                 const targetContainer = document.querySelector(`.param-card[data-param-key="${paramKey}"]`).parentElement;
                displayParameterForm(exchangeId, symbol, strategyKey, currentParams[paramKey], targetContainer);

                // 保存ボタンを有効化
                document.getElementById('save-btn').disabled = false;
            });
        });
    }

    // 削除ボタンのイベントリスナーを設定
    formCard.querySelectorAll('.delete-param-btn').forEach(button => {
        button.addEventListener('click', function() {
            const paramKey = this.getAttribute('data-param-key');
            const paramName = this.getAttribute('data-param-name');

            // パラメータを削除
            if (currentParams[paramKey] && currentParams[paramKey].hasOwnProperty(paramName)) {
                delete currentParams[paramKey][paramName];

                // 変更されたパラメータにも削除を反映
                if (!modifiedParams[paramKey]) {
                    modifiedParams[paramKey] = {};
                }
                modifiedParams[paramKey][paramName] = null; // 削除を示すためにnullを設定

                // フォームを再表示
                const [exchangeId, symbol, strategyKey] = paramKey.split(':');
                 const targetContainer = document.querySelector(`.param-card[data-param-key="${paramKey}"]`).parentElement;
                displayParameterForm(exchangeId, symbol, strategyKey, currentParams[paramKey], targetContainer);

                // 保存ボタンを有効化
                document.getElementById('save-btn').disabled = false;
            }
        });
    });
}

/**
 * フォームフィールドのHTMLを生成
 * @param {string} paramName - パラメータ名
 * @param {any} paramValue - パラメータ値
 * @param {string} paramKey - パラメータキー（exchange:symbol:strategy）
 * @returns {string} HTML文字列
 */
function createFormField(paramName, paramValue, paramKey) {
    const type = typeof paramValue;
    let fieldHtml = `
        <div class="mb-3">
            <label for="${paramKey}-${paramName}" class="form-label">${paramName}</label>
    `;

    if (type === 'boolean') {
        // 真偽値の場合はチェックボックス
        fieldHtml += `
            <div class="form-check">
                <input type="checkbox" class="form-check-input" id="${paramKey}-${paramName}"
                       ${paramValue ? 'checked' : ''} data-param-name="${paramName}">
                <label class="form-check-label" for="${paramKey}-${paramName}">有効</label>
            </div>
        `;
    } else if (type === 'number') {
        // 数値の場合は数値入力フィールド
        fieldHtml += `
            <input type="number" class="form-control" id="${paramKey}-${paramName}"
                   value="${paramValue}" step="any" data-param-name="${paramName}">
        `;
    } else if (type === 'object' && paramValue !== null) {
        // オブジェクトまたは配列の場合はJSON表示
        const jsonValue = JSON.stringify(paramValue, null, 2);
        fieldHtml += `
            <textarea class="form-control" id="${paramKey}-${paramName}"
                     rows="4" data-param-name="${paramName}">${jsonValue}</textarea>
            <small class="form-text text-muted">JSONオブジェクトの形式で入力してください。</small>
        `;
    } else {
        // その他（文字列など）はテキスト入力フィールド
        fieldHtml += `
            <input type="text" class="form-control" id="${paramKey}-${paramName}"
                   value="${paramValue !== null ? paramValue : ''}" data-param-name="${paramName}">
        `;
    }

    // 削除ボタン
    fieldHtml += `
            <button type="button" class="btn btn-sm btn-outline-danger mt-2 delete-param-btn"
                    data-param-key="${paramKey}" data-param-name="${paramName}">
                このパラメータを削除
            </button>
        </div>
    `;

    return fieldHtml;
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

// ページのスタイルを追加
document.head.insertAdjacentHTML('beforeend', `
<style>
    #loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
    }
    .param-card {
        transition: all 0.3s ease;
    }
    .param-card:hover {
        box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
    }
    .delete-param-btn {
        margin-left: 0.5rem;
        font-size: 0.8rem;
    }
</style>
`);