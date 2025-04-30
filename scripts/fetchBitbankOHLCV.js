const ccxt = require('ccxt');
const { OHLCVTimeFrames } = require('../src/common/const');
const { fetchOHLCVData, addOhlcvMongoDB, initializeDB } = require('../src/database/manager');

async function fetchAndSaveBitbankOHLCV() {
    let exchangeBB;
    try {
        // DB接続を確立
        await initializeDB();

        // Bitbank取引所インスタンスを作成
        exchangeBB = new ccxt.bitbank();

        // 全銘柄リストを取得
        const markets = await exchangeBB.loadMarkets();
        const symbols = Object.keys(markets);

        console.log(`Bitbankの全${symbols.length}銘柄に対してOHLCVデータを取得します。`);

        // 各銘柄とタイムフレームの組み合わせでデータを取得・保存
        for (const symbol of symbols) {
            for (const timeframe of OHLCVTimeFrames) {
                console.log(`${symbol} - ${timeframe} のOHLCVデータを取得中...`);

                try {
                    // 1年分のOHLCVデータを取得するためのlimitを計算
                    let limit;
                    switch (timeframe) {
                        case '1m': limit = 525600; break;
                        case '5m': limit = 105120; break;
                        case '15m': limit = 35040; break;
                        case '30m': limit = 17520; break;
                        case '1h': limit = 8760; break;
                        case '4h': limit = 2190; break;
                        case '1d': limit = 365; break;
                        case '1w': limit = 52; break;
                        default:
                            console.warn(`未知のタイムフレーム: ${timeframe} - スキップします`);
                            continue;
                    }

                    // OHLCVデータを取得
                    const ohlcvs = await fetchOHLCVData(exchangeBB, symbol, timeframe, limit);

                    if (!ohlcvs || ohlcvs.length === 0) {
                        console.log(`${symbol} - ${timeframe}: データが見つかりませんでした。`);
                        continue;
                    }

                    console.log(`${symbol} - ${timeframe}: ${ohlcvs.length}件のデータを取得しました。保存を開始します。`);

                    // 取得したOHLCVデータをMongoDBに保存
                    for (const ohlcv of ohlcvs) {
                        const [timestamp, open, high, low, close, volume] = ohlcv;
                        const ohlcvData = {
                            exchange: exchangeBB.id,
                            symbol: symbol,
                            timeframe: timeframe,
                            timestamp: timestamp,
                            open: open,
                            high: high,
                            low: low,
                            close: close,
                            volume: volume,
                        };
                        await addOhlcvMongoDB(ohlcvData);
                    }
                    console.log(`${symbol} - ${timeframe}: ${ohlcvs.length}件のデータを保存しました。`);

                } catch (error) {
                    console.error(`${symbol} - ${timeframe} のデータ取得・保存エラー:`, error);
                }
            }
        }

        console.log('Bitbank OHLCVデータの取得・保存処理が完了しました。');

    } catch (error) {
        console.error('スクリプト実行中にエラーが発生しました:', error);
    } finally {
        // DB接続を閉じる
        // ccxt の dispose メソッドがあれば使用、なければ何もしない
        if (exchangeBB && typeof exchangeBB.dispose === 'function') {
             exchangeBB.dispose();
        }
        // MongoDB接続は initializeDB 内で管理されているため、ここでは閉じない
        // 必要であれば manager.js に closeDB 関数を追加し、ここで呼び出す
    }
}

// スクリプト実行
fetchAndSaveBitbankOHLCV();