/**
 * 戦略パラメータ関連のコントローラー
 */
const { getStrategyParameters, saveStrategyParameters } = require('../../database/manager');

/**
 * 戦略パラメータを取得するコントローラー
 * @param {Object} req - リクエストオブジェクト
 * @param {Object} res - レスポンスオブジェクト
 */
async function getParameters(req, res) {
  const { exchangeId, symbol, strategyKey } = req.query;

  // 必須パラメータのチェック
  if (!exchangeId || !symbol || !strategyKey) {
    return res.status(400).json({
      error: 'exchangeId, symbol, strategyKeyは必須パラメータです。'
    });
  }

  try {
    const params = await getStrategyParameters(exchangeId, symbol, strategyKey);
    
    if (params === null) {
      return res.status(404).json({
        error: '指定されたパラメータは見つかりませんでした。',
        exchangeId,
        symbol,
        strategyKey
      });
    }

    return res.json({
      exchangeId,
      symbol,
      strategyKey,
      params
    });
  } catch (error) {
    console.error('パラメータ取得中にエラーが発生しました:', error);
    return res.status(500).json({
      error: 'パラメータの取得に失敗しました。',
      message: error.message
    });
  }
}

/**
 * 戦略パラメータを更新するコントローラー
 * @param {Object} req - リクエストオブジェクト
 * @param {Object} res - レスポンスオブジェクト
 */
async function updateParameters(req, res) {
  const { exchangeId, symbol, strategyKey, params } = req.body;

  // 必須パラメータのチェック
  if (!exchangeId || !symbol || !strategyKey || !params || typeof params !== 'object') {
    return res.status(400).json({
      error: 'exchangeId, symbol, strategyKey, paramsは必須パラメータです。paramsはオブジェクト形式である必要があります。'
    });
  }

  try {
    const success = await saveStrategyParameters(exchangeId, symbol, strategyKey, params);
    
    if (!success) {
      return res.status(500).json({
        error: 'パラメータの保存に失敗しました。'
      });
    }

    return res.json({
      success: true,
      message: 'パラメータが正常に保存されました。',
      exchangeId,
      symbol,
      strategyKey
    });
  } catch (error) {
    console.error('パラメータ更新中にエラーが発生しました:', error);
    return res.status(500).json({
      error: 'パラメータの更新に失敗しました。',
      message: error.message
    });
  }
}

module.exports = {
  getParameters,
  updateParameters
};