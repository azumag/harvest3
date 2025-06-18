
// Bitbankでサポートされているタイムフレームのみを使用
// 4h, 8h, 12h, 1d, 1wはBitbank APIでサポートされていないため除外
const OHLCVTimeFrames = ["1m", "5m", "15m", "30m", "1h"];
// const OHLCVTimeFrames = ["1d"]; // 古い設定（使用不可）

module.exports = {
  OHLCVTimeFrames,
}