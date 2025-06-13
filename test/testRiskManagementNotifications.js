/**
 * リスク管理Discord通知機能のテスト
 */
const { initialize } = require('../src/database/redisDatabase');
const { 
  DEFAULT_RISK_SETTINGS,
  savePosition,
  recordBuyPosition,
  recordPnL,
  generateRiskManagementReport,
  sendRiskManagementReport,
  clearPositionStore,
  clearPnLTracker
} = require('../src/strategies/utils/riskManagement');
const { postOrderToDiscord } = require('../src/common/notifications');

async function testRiskManagementNotifications() {
  console.log('=== リスク管理Discord通知機能テスト開始 ===\n');
  
  try {
    // Redis初期化
    await initialize();
    console.log('Redis接続成功\n');
    
    // テストデータをクリア
    await clearPositionStore();
    await clearPnLTracker();
    
    const exchange = { id: 'bitbank' };
    const symbol = 'BTC/JPY';
    const strategyKey = 'testStrategy';
    
    console.log('1. ポジション開始通知テスト');
    
    // テスト用のポジション作成
    const mockOrder = {
      id: `test_order_${Date.now()}`,
      amount: 0.01
    };
    
    // ポジション記録（通知が送信される）
    await recordBuyPosition(exchange, symbol, strategyKey, mockOrder, 15000000);
    console.log('✅ 新規ポジション開始通知を送信しました\n');
    
    console.log('2. 損益記録と統計レポートテスト');
    
    // 損益データを記録
    await recordPnL(exchange.id, strategyKey, -30000);   // 3万円の損失
    await recordPnL(exchange.id, strategyKey, 50000);    // 5万円の利益
    await recordPnL(exchange.id, strategyKey, -15000);   // 1.5万円の損失
    
    console.log('テスト損益データを記録:');
    console.log('  -30,000円, +50,000円, -15,000円');
    console.log('  合計: +5,000円\n');
    
    console.log('3. リスク管理レポート生成テスト');
    
    // レポート生成
    const report = await generateRiskManagementReport(exchange, strategyKey, DEFAULT_RISK_SETTINGS);
    
    if (report) {
      console.log('✅ リスク管理レポート生成成功:');
      console.log(`  ポジション数: ${report.positions.total}`);
      console.log(`  本日損益: ${report.pnl.daily.toLocaleString()}円`);
      console.log(`  日次ドローダウン: ${report.drawdown.daily.current}%/${report.drawdown.daily.limit}%`);
      console.log();
    }
    
    console.log('4. Discord通知テスト');
    
    // 手動でDiscord通知をテスト
    if (postOrderToDiscord) {
      // ポジション制限通知のテスト
      const positionLimitMessage = `⛔ [リスク管理] ポジション制限到達 ⛔\n` +
                                   `取引所: ${exchange.id}\n` +
                                   `通貨ペア: ${symbol}\n` +
                                   `戦略: ${strategyKey}\n` +
                                   `制限理由: テスト: 最大ポジション数に達しています\n` +
                                   `現在価格: 15,000,000円\n` +
                                   `🛑 新規買い注文をスキップしました`;
      
      await postOrderToDiscord(positionLimitMessage);
      console.log('✅ ポジション制限通知テストを送信しました');
      
      // トレーリングストップ通知のテスト
      const trailingStopMessage = `📈 [リスク管理] トレーリングストップ更新 📈\n` +
                                  `取引所: ${exchange.id}\n` +
                                  `通貨ペア: ${symbol}\n` +
                                  `戦略: ${strategyKey}\n` +
                                  `注文ID: ${mockOrder.id}\n` +
                                  `エントリー価格: 15,000,000円\n` +
                                  `新最高値: 15,300,000円\n` +
                                  `現在利益: 2.00%\n` +
                                  `📊 トレーリングストップが追従中です`;
      
      await postOrderToDiscord(trailingStopMessage);
      console.log('✅ トレーリングストップ通知テストを送信しました');
      
      // ドローダウン警告通知のテスト
      const drawdownMessage = `🚨 [リスク管理] 日次最大損失制限到達 🚨\n` +
                              `取引所: ${exchange.id}\n` +
                              `戦略: ${strategyKey}\n` +
                              `本日の損失: -50,000円\n` +
                              `損失率: 5.00%\n` +
                              `制限値: 5.00%\n` +
                              `⚠️ 新規取引を停止しました`;
      
      await postOrderToDiscord(drawdownMessage);
      console.log('✅ ドローダウン警告通知テストを送信しました');
      
      console.log();
    } else {
      console.log('⚠️ Discord通知が無効になっています（設定確認）\n');
    }
    
    console.log('5. 定期レポート送信テスト');
    
    // 定期レポートを送信
    await sendRiskManagementReport(exchange, strategyKey, DEFAULT_RISK_SETTINGS);
    console.log('✅ 定期レポートを送信しました\n');
    
    console.log('=== 通知機能テスト完了 ===');
    console.log('\n📱 Discord通知の確認:');
    console.log('1. 新規ポジション開始通知');
    console.log('2. ポジション制限到達通知');
    console.log('3. トレーリングストップ更新通知');
    console.log('4. ドローダウン制限到達通知');
    console.log('5. リスク管理定期レポート');
    console.log('\nDiscordチャンネルで上記の通知が送信されているか確認してください。');
    
  } catch (error) {
    console.error('❌ テスト実行エラー:', error.message);
  }
  
  process.exit(0);
}

// テスト実行
testRiskManagementNotifications().catch(console.error);