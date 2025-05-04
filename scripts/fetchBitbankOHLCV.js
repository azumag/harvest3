const ccxt = require('ccxt');
const { OHLCVTimeFrames } = require('../src/common/const');
const { fetchOHLCVData, addOhlcvMongoDB, initializeDB, getOHLCVByParams } = require('../src/database/manager');

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

        console.log(`Bitbankの全${symbols.length}銘柄に対して直近1週間のOHLCVデータを取得します。`);

        // 1週間前の日時を計算
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const since = oneWeekAgo.getTime();

        // 各銘柄とタイムフレームの組み合わせでデータを取得・保存
        for (const symbol of symbols) {
            for (const timeframe of OHLCVTimeFrames) {
                console.log(`${symbol} - ${timeframe} の直近1週間のOHLCVデータを取得中...`);

                // const testOHLCV = await getOHLCVByParams(exchangeBB, symbol, timeframe, 1, new Date().getTime());
                // if (testOHLCV && testOHLCV.length > 0) {
                //     console.log(`${symbol} - ${timeframe} のOHLCVデータは既にDBに存在します。スキップします。`);
                //     continue;
                // }

                try {
                    // 1ヶ月分のOHLCVデータを取得するためのlimitを計算
                    let limit;
                    switch (timeframe) {
                        case '1m': limit = 10080; break; // 7日 * 24時間 * 60分
                        case '5m': limit = 2016; break;  // 7日 * 24時間 * 12
                        case '15m': limit = 672; break;  // 7日 * 24時間 * 4
                        case '30m': limit = 336; break;  // 7日 * 24時間 * 2
                        case '1h': limit = 168; break;   // 7日 * 24時間
                        case '4h': limit = 42; break;    // 7日 * 6
                        case '8h': limit = 21; break;    // 7日 * 3
                        case '12h': limit = 14; break;   // 7日 * 2
                        case '1d': limit = 7; break;     // 7日
                        case '1w': limit = 1; break;     // 1週間
                        default:
                            console.warn(`未知のタイムフレーム: ${timeframe} - スキップします`);
                            continue;
                    }

                    // OHLCVデータを取得
                    const ohlcvs = await fetchOHLCVData(exchangeBB, symbol, timeframe, limit, { forceUpdate: true });

                    if (!ohlcvs || ohlcvs.length === 0) {
                        console.log(`${symbol} - ${timeframe}: データが見つかりませんでした。`);
                        continue;
                    }

                    console.log(`${symbol} - ${timeframe}: ${ohlcvs.length}件のデータを取得しました。自動的に保存されています`);

                } catch (error) {
                    console.error(`${symbol} - ${timeframe} のデータ取得・保存エラー:`, error);
                }
            }
        }

        console.log('Bitbank 直近1週間のOHLCVデータの取得・保存処理が完了しました。');

    } catch (error) {
        console.error('スクリプト実行中にエラーが発生しました:', error);
    } finally {
        // DB接続を閉じる
        if (exchangeBB && typeof exchangeBB.dispose === 'function') {
             exchangeBB.dispose();
        }
    }
}

// スクリプト実行
fetchAndSaveBitbankOHLCV();