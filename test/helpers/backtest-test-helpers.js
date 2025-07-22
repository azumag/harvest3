/**
 * バックテスト関数のテスト用ヘルパー
 * 内部関数を外部からテスト可能にするためのラッパー
 */

/**
 * オブジェクトから数値型のプロパティキーを抽出する
 * @param {Object|null|undefined} config - 設定オブジェクト
 * @returns {Array} 数値型のプロパティキーの配列
 */
function extractNumericParameterKeys(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return [];
  }
  return Object.keys(config).filter(key => typeof config[key] === 'number');
}

/**
 * パラメータの全ての組み合わせを生成する
 * @param {Object} defaultConfig - デフォルト設定
 * @param {Array} numericKeys - 数値型のキーの配列
 * @param {number} n - パラメータの変動幅（デフォルト0.5）
 * @param {number} step - パラメータのステップ数（デフォルト10）
 * @returns {Array} 全ての組み合わせの配列
 */
function generateParameterCombinations(defaultConfig, numericKeys, n = 0.5, step = 10) {
  if (numericKeys.length === 0) {
    return [{}];
  }

  // null/undefinedチェックを追加
  if (!defaultConfig || typeof defaultConfig !== 'object') {
    console.warn('generateParameterCombinations: defaultConfigがnullまたはundefinedです');
    return [{}];
  }

  const [currentKey, ...remainingKeys] = numericKeys;
  const combinations = [];

  // パラメータのデフォルト値
  let defaultValue = defaultConfig[currentKey];
  
  // デフォルト値が数値でない場合はフォールバック値を使用
  if (typeof defaultValue !== 'number') {
    console.warn(`generateParameterCombinations: ${currentKey}の値が数値ではありません:`, defaultValue);
    defaultValue = 10; // フォールバック値
  }

  // パラメータに応じた範囲を設定
  const paramMin = Math.max(1, Math.floor(defaultValue * (1 - n)));
  const paramMax = Math.ceil(defaultValue * (1 + n));
  const paramStep = Math.max(1, Math.floor((paramMax - paramMin) / step));

  for (let value = paramMin; value <= paramMax; value += paramStep) {
    const subCombinations = generateParameterCombinations(defaultConfig, remainingKeys, n, step);

    for (const subComb of subCombinations) {
      combinations.push({ ...subComb, [currentKey]: value });
    }
  }

  return combinations;
}

/**
 * 正規分布に従った乱数を生成する（Box-Mullerアルゴリズム）
 * @param {number} mean - 平均
 * @param {number} stdDev - 標準偏差
 * @returns {number} 正規分布に従った乱数
 */
function generateNormalRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) {
    u = Math.random();
  }
  while (v === 0) {
    v = Math.random();
  }
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

/**
 * 正規乱数を使ったパラメータ組み合わせを生成する
 * @param {Object} defaultConfig - デフォルト設定
 * @param {Array} numericKeys - 数値型のキーの配列
 * @param {number} count - 生成する組み合わせの数（デフォルト60）
 * @param {number} n - パラメータの変動幅（デフォルト0.1）
 * @returns {Array} ランダムに生成されたパラメータ組合せの配列
 */
function generateRandomParameterCombinations(defaultConfig, numericKeys, count = 60, n = 0.1) {
  if (numericKeys.length === 0) {
    return [{}];
  }

  // null/undefinedチェックを追加
  if (!defaultConfig || typeof defaultConfig !== 'object') {
    console.warn('generateRandomParameterCombinations: defaultConfigがnullまたはundefinedです');
    return [{}];
  }

  const combinations = [];

  // デフォルト設定を最初に追加
  const defaultCombo = {};
  for (const key of numericKeys) {
    const defaultValue = defaultConfig[key];
    if (typeof defaultValue !== 'number') {
      console.warn(`generateRandomParameterCombinations: ${key}の値が数値ではありません:`, defaultValue);
      defaultCombo[key] = 10; // フォールバック値
    } else {
      defaultCombo[key] = defaultValue;
    }
  }
  combinations.push(defaultCombo);

  // 残りのランダム組み合わせを生成
  for (let i = 0; i < count - 1; i++) {
    const combo = {};
    for (const key of numericKeys) {
      const defaultValue = defaultConfig[key];
      let baseValue = 10; // フォールバック値
      
      if (typeof defaultValue === 'number') {
        baseValue = defaultValue;
      }
      
      // 標準偏差はデフォルト値のn%程度に設定
      const stdDev = Math.max(1, baseValue * n);
      // 正規分布に従ったランダム値を生成し、整数に丸める
      let value = Math.round(generateNormalRandom(baseValue, stdDev));
      // 最小値を1に制限
      value = Math.max(1, value);

      combo[key] = value;
    }
    combinations.push(combo);
  }

  return combinations;
}

module.exports = {
  extractNumericParameterKeys,
  generateParameterCombinations,
  generateRandomParameterCombinations,
  generateNormalRandom
};