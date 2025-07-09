/**
 * DOT/JPYの注文ステータスをチェックするためのテストスクリプト
 * fetchMyTradesを使用して取引履歴から注文状態を分析します
 */
const { exchangeBB } = require('../src/config');

async function checkOrderStatus() {
  try {
    console.log('='.repeat(50));
    console.log('bitbank DOT/JPY 注文ステータスチェック開始');
    console.log('='.repeat(50));

    // 取引所接続確認
    console.log('bitbank APIに接続中...');
    const markets = await exchangeBB.loadMarkets();
    console.log('取引所に接続しました。DOT/JPYの情報を取得します...');

    const symbol = 'DOT/JPY';
    // DOT/JPYのマーケット情報を取得
    const marketInfo = markets[symbol];
    if (!marketInfo) {
      throw new Error(`${symbol}の情報は利用できません。シンボルが正しいか確認してください。`);
    }
    console.log(`${symbol}の情報を取得しました:`, {
      id: marketInfo.id,
      baseId: marketInfo.baseId,
      quoteId: marketInfo.quoteId,
      active: marketInfo.active
    });

    // bitbankの注文取得機能サポート状況を確認
    console.log('\nbitbankの注文取得機能サポート状況:');
    console.log(`fetchClosedOrders: ${exchangeBB.has.fetchClosedOrders ? 'サポート' : 'サポートなし'}`);
    console.log(`fetchMyTrades: ${exchangeBB.has.fetchMyTrades ? 'サポート' : 'サポートなし'}`);
    console.log(`fetchOrders: ${exchangeBB.has.fetchOrders ? 'サポート' : 'サポートなし'}`);

    // トレード履歴から注文情報を構築（marketMaking.jsと同じロジック）
    console.log(`\n${symbol}のトレード履歴を取得中...`);
    const completedOrders = [];

    try {
      // 1時間前のタイムスタンプを計算（ミリ秒）
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      console.log(`1時間前（${new Date(oneHourAgo).toLocaleString('ja-JP')}）からのトレード履歴を取得します...`);

      const myTrades = await exchangeBB.fetchMyTrades(symbol, since=oneHourAgo);
      console.log(`${myTrades.length}件のトレード履歴を取得しました。`);

      // トレードデータの一例を表示
      if (myTrades.length > 0) {
        console.log('\nトレードデータの例:');
        console.log('-'.repeat(40));
        console.log(JSON.stringify(myTrades[0], null, 2));
      }

      // トレードから注文情報を構築
      for (const trade of myTrades) {
        if (trade.order) {
          // 重複を避ける
          if (completedOrders.some(order => order.id === trade.order)) {
            continue;
          }

          // キャンセル状態を判定（トレード情報からキャンセル状態を推測）
          let status = 'filled';
          if (trade.info && typeof trade.info === 'object') {
            // トレード情報のさまざまなフィールドからキャンセル状態を検出
            const infoStr = JSON.stringify(trade.info).toLowerCase();
            if (infoStr.includes('cancel')) {
              status = 'canceled';
            }
          }

          completedOrders.push({
            id: trade.order,
            status: status,
            price: trade.price,
            amount: trade.amount,
            side: trade.side,
            timestamp: trade.timestamp,
            info: trade.info
          });
        }
      }

      console.log(`取引履歴から${completedOrders.length}件の注文情報を構築しました。`);

      if (completedOrders.length === 0) {
        console.log(`警告: ${symbol}の注文が見つかりませんでした。`);
      } else {
        // ステータスの種類をカウント
        const statusCounts = {};
        completedOrders.forEach(order => {
          const status = order.status || 'unknown';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });

        console.log('\n注文ステータスの集計:');
        console.log('-'.repeat(30));
        Object.entries(statusCounts).forEach(([status, count]) => {
          console.log(`${status}: ${count}件`);
        });

        console.log('\n注文詳細:');
        console.log('-'.repeat(70));
        completedOrders.forEach((order, index) => {
          console.log(`注文 #${index + 1}:`);
          console.log(`  ID: ${order.id}`);
          console.log(`  サイド: ${order.side}`);
          console.log(`  ステータス: ${order.status}`);
          console.log(`  価格: ${order.price}`);
          console.log(`  数量: ${order.amount}`);
          console.log(`  作成日時: ${new Date(order.timestamp).toLocaleString('ja-JP')}`);
          console.log('-'.repeat(40));
        });

        // キャンセルされた注文の特別調査
        const canceledOrders = completedOrders.filter(order =>
          order.status &&
          (order.status.toLowerCase() === 'canceled' ||
           order.status.toLowerCase() === 'cancelled' ||
           order.status.toLowerCase().includes('cancel'))
        );

        console.log('\nキャンセルされた注文の検出結果:');
        console.log('-'.repeat(50));
        console.log(`検出方法1 - status === 'canceled': ${completedOrders.filter(o => o.status === 'canceled').length}件`);
        console.log(`検出方法2 - status.toLowerCase() === 'canceled': ${completedOrders.filter(o => o.status && o.status.toLowerCase() === 'canceled').length}件`);
        console.log(`検出方法3 - status.toLowerCase() === 'cancelled': ${completedOrders.filter(o => o.status && o.status.toLowerCase() === 'cancelled').length}件`);
        console.log(`検出方法4 - status.toLowerCase().includes('cancel'): ${completedOrders.filter(o => o.status && o.status.toLowerCase().includes('cancel')).length}件`);
        console.log(`総検出数: ${canceledOrders.length}件`);

        if (canceledOrders.length > 0) {
          console.log('\nキャンセルされた注文の例:');
          console.log('-'.repeat(40));
          const exampleOrder = canceledOrders[0];
          console.log(`  ID: ${exampleOrder.id}`);
          console.log(`  ステータス: ${exampleOrder.status}`);
          console.log(`  サイド: ${exampleOrder.side}`);
          console.log(`  生データ: ${JSON.stringify(exampleOrder.info, null, 2)}`);
        }
      }
    } catch (tradeError) {
      console.error('トレード履歴の取得中にエラーが発生しました:', tradeError.message);
    }

    // アクティブな注文も確認
    console.log(`\n${symbol}のオープン注文を取得中...`);
    try {
      const openOrders = await exchangeBB.fetchOpenOrders(symbol);
      console.log(`${openOrders.length}件のオープン注文があります。`);

      if (openOrders.length > 0) {
        console.log('\nオープン注文の例:');
        console.log('-'.repeat(40));
        const exampleOrder = openOrders[0];
        console.log(`  ID: ${exampleOrder.id}`);
        console.log(`  ステータス: ${exampleOrder.status}`);
        console.log(`  サイド: ${exampleOrder.side}`);
        console.log(`  生データ: ${JSON.stringify(exampleOrder.info, null, 2)}`);
      }
    } catch (orderError) {
      console.error('オープン注文の取得中にエラーが発生しました:', orderError.message);
    }

    console.log('\n='.repeat(50));
    console.log('テスト完了');
    console.log('='.repeat(50));

  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    if (error.stack) {
      console.error('スタックトレース:', error.stack);
    }
  }
}

// スクリプト実行
checkOrderStatus();