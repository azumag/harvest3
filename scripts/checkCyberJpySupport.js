const ccxt = require('ccxt');

(async () => {
    const bitbank = new ccxt.bitbank();
    try {
        console.log('=== Bitbank CYBER/JPY サポート確認 ===\n');
        
        // 取引所の市場情報をロード
        await bitbank.loadMarkets();
        
        // サポートされているシンボルの一覧を取得
        const symbols = Object.keys(bitbank.markets);
        console.log(`総ペア数: ${symbols.length}`);
        
        // CYBERを含むペアを検索
        const cyberPairs = symbols.filter(s => s.includes('CYBER'));
        console.log(`\nCYBERを含むペア: ${cyberPairs.length > 0 ? cyberPairs.join(', ') : 'なし'}`);
        
        // CYBER/JPYの存在を確認
        if (symbols.includes('CYBER/JPY')) {
            console.log('\n[OK] CYBER/JPY はサポートされています。');
            
            // 詳細情報を表示
            const market = bitbank.markets['CYBER/JPY'];
            console.log('\n=== CYBER/JPY マーケット詳細 ===');
            console.log(`- ID: ${market.id}`);
            console.log(`- Symbol: ${market.symbol}`);
            console.log(`- Base: ${market.base}`);
            console.log(`- Quote: ${market.quote}`);
            console.log(`- Active: ${market.active}`);
            console.log(`- Type: ${market.type}`);
            console.log(`- Spot: ${market.spot}`);
            console.log(`- Precision:`, market.precision);
            console.log(`- Limits:`, market.limits);
            
            // fetchOHLCVサポートを確認
            console.log(`\nfetchOHLCV サポート: ${bitbank.has['fetchOHLCV'] ? 'Yes' : 'No'}`);
            
            // 実際にOHLCVデータを取得してみる
            if (bitbank.has['fetchOHLCV']) {
                console.log('\n=== CYBER/JPY OHLCVデータ取得テスト ===');
                
                const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '8h', '12h', '1d', '1w'];
                
                for (const timeframe of timeframes) {
                    try {
                        console.log(`\n${timeframe}のデータ取得中...`);
                        const ohlcv = await bitbank.fetchOHLCV('CYBER/JPY', timeframe, undefined, 5);
                        
                        if (ohlcv && ohlcv.length > 0) {
                            console.log(`  ✓ ${timeframe}: ${ohlcv.length}件取得成功`);
                            console.log(`  最新: ${new Date(ohlcv[ohlcv.length - 1][0]).toLocaleString('ja-JP')}`);
                            console.log(`  価格: ${ohlcv[ohlcv.length - 1][4]} JPY`);
                        } else {
                            console.log(`  × ${timeframe}: データなし`);
                        }
                    } catch (error) {
                        if (error.message.includes('10000') || error.message.includes('Invalid')) {
                            console.log(`  × ${timeframe}: サポートされていないタイムフレーム`);
                        } else {
                            console.log(`  × ${timeframe}: エラー - ${error.message}`);
                        }
                    }
                    
                    // API制限対策
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
        } else {
            console.error('\n[ERROR] CYBER/JPY はBitbankでサポートされていません。');
            
            // 類似のペアを探す
            const jpyPairs = symbols.filter(s => s.endsWith('/JPY'));
            console.log(`\n参考: JPYペア一覧 (${jpyPairs.length}個):`);
            jpyPairs.sort().forEach(pair => console.log(`  - ${pair}`));
        }
        
    } catch (error) {
        console.error('エラーが発生しました:', error.message);
        console.error('詳細:', error);
    }
})();