const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fetch = require('node-fetch');
const { initializeDB } = require('../database/manager');
const router = require('./routes');

require('dotenv').config();

// localtunnelモジュールをグローバルスコープで宣言
// Note: localtunnelは削除されました（セキュリティ脆弱性のため）
const localtunnel = null;

// APIサーバーセットアップ
const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェア
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// 静的ファイル提供（ウェブUI）
app.use(express.static(path.join(__dirname, '../web')));

// APIルート
app.use('/api', router);

// メインHTMLルート
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/history.html'));
});

app.get('/analysis', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/analysis.html'));
});

// サーバー起動
app.listen(PORT, '0.0.0.0', () => {
  // サーバー起動ログはconsole.errorを使用
  console.error(`API & Web Server running on port ${PORT}`);
  
  // データベースの初期化を非同期で実行（サーバー起動をブロックしない）
  setTimeout(async () => {
    try {
      await initializeDB();
      // データベース初期化成功ログはconsole.errorを使用
      console.error('データベースが正常に初期化されました');
    } catch (error) {
      console.error('データベース初期化エラー:', error);
    }
  }, 1000); // 1秒後に初期化開始

  if (process.env.USE_LOCALTUNNEL === 'true') {
    // localtunnel無効化通知ログはconsole.errorを使用
    console.error('localtunnel機能が有効になっていますが、セキュリティ上の理由で無効化されています');
    console.error('代替手段として、ngrok や cloudflared tunnel の使用を検討してください');
    // localtunnelは削除されたため、この機能は無効です
  } else {
    console.error('localtunnel機能は無効になっています');
  }
});

module.exports = app;
