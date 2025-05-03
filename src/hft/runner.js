const { config } = require('../config');
const hft = require('./index');

// アプリケーション起動時にHFT戦略を開始
async function startApp() {
  try {
    // 他の初期化処理
    
    // HFT戦略の開始
    await hft.startHFTStrategy(config);
    
  } catch (error) {
    console.error(`アプリケーション起動エラー: ${error.message}`);
    // エラー通知などの処理
  }
}

// アプリケーション開始
startApp();

// プロセス終了時の処理
process.on('SIGINT', async () => {
  console.log('アプリケーション終了中...');
  
  // HFT戦略の停止
  hft.stopHFTStrategy();
  
  // 他のクリーンアップ処理
  
  process.exit(0);
});