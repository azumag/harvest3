/**
 * 戦略関連のコントローラー
 */
const { config } = require('../../config');

/**
 * 利用可能な戦略一覧を取得する
 * @param {Object} req - リクエストオブジェクト
 * @param {Object} res - レスポンスオブジェクト
 */
const getStrategiesList = (req, res) => {
  try {
    // config.jsのstrategiesオブジェクトからキーを取得
    const strategies = Object.keys(config.strategies);

    // 有効な戦略のみをフィルタリング（必要に応じて）
    // const enabledStrategies = strategies.filter(strategy => config.strategies[strategy].enabled);
    console.log(strategies);

    // すべての戦略を返す（UIでは無効な戦略も表示可能にする）
    res.json(strategies);
  } catch (error) {
    console.error('戦略一覧の取得中にエラーが発生しました:', error);
    res.status(500).json({ error: '戦略一覧の取得に失敗しました' });
  }
};

module.exports = {
  getStrategiesList
};