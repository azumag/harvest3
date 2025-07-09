/**
 * Web UI共通ユーティリティ関数
 * Common UI utilities for web interface
 */

/**
 * パラメータ設定用の入力フィールドを作成
 * Creates input field for parameter settings
 * @param {string} paramName - パラメータ名
 * @param {*} paramValue - パラメータ値
 * @param {string} paramKey - パラメータキー
 * @returns {string} - HTML文字列
 */
function createInputField(paramName, paramValue, paramKey) {
  const type = typeof paramValue;
  const inputId = `${paramKey}-${paramName}`.replace(/[^a-zA-Z0-9-]/g, '_'); // IDとして有効な文字のみ使用
  let inputHtml = '';

  // data-param-key と data-param-name を追加
  const dataAttributes = `data-param-key="${paramKey}" data-param-name="${paramName}"`;

  // すべてのinputに適用する共通スタイル (border-box, width 100%, no border/margin/padding)
  const commonStyles = 'box-sizing: border-box; width: 100%; border: none; margin: 0; padding: 0.1rem 0.25rem; height: 100%; min-height: 1.8em;';

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
      <input type="number" class="form-control" id="${inputId}"
             value="${paramValue}" step="any" ${dataAttributes}
             style="${commonStyles}">
    `;
  } else {
    // 文字列の場合はテキスト入力フィールド
    inputHtml = `
      <input type="text" class="form-control" id="${inputId}"
             value="${paramValue}" ${dataAttributes}
             style="${commonStyles}">
    `;
  }

  return inputHtml;
}

/**
 * 時間を見やすい形式でフォーマット
 * Formats time in human readable format
 * @param {number} hours - 時間数
 * @returns {string} - フォーマットされた時間文字列
 */
function formatHours(hours) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}分`;
  } else if (hours < 24) {
    return `${hours.toFixed(1)}時間`;
  } else {
    const days = Math.floor(hours / 24);
    const remainingHours = (hours % 24).toFixed(1);
    return `${days}日 ${remainingHours}時間`;
  }
}

// ブラウザ環境でグローバルスコープに追加
if (typeof window !== 'undefined') {
  window.CommonUI = {
    createInputField,
    formatHours
  };
}