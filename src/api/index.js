const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fetch = require('node-fetch');
const { initializeDB } = require('../database/manager');
const router = require('./routes');

require('dotenv').config();
console.log('環境変数 USE_LOCALTUNNEL:', process.env.USE_LOCALTUNNEL);
console.log('localtunnelモジュールを読み込む前...');

// localtunnelモジュールをグローバルスコープで宣言
let localtunnel;

try {
  localtunnel = require('localtunnel');
  console.log('localtunnelモジュールの読み込み成功');
} catch (error) {
  console.error('localtunnelモジュールの読み込みエラー:', error.message);
  console.error('このエラーは、package.jsonに"localtunnel"が依存関係として含まれていないことが原因である可能性があります');
}

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
app.listen(PORT, async () => {
  console.log(`API & Web Server running on port ${PORT}`);
  
  // データベースの初期化
  try {
    await initializeDB();
    console.log('データベースが正常に初期化されました');
  } catch (error) {
    console.error('データベース初期化エラー:', error);
  }

  if (process.env.USE_LOCALTUNNEL === 'true') {
    console.log('localtunnel機能が有効になっています');
    try {
      // localtunnelモジュールが正常に読み込まれている場合のみ実行
      if (typeof localtunnel === 'function') {
        try {
          const tunnel = await localtunnel({ port: PORT });
          console.log(`Localtunnel URL: ${tunnel.url}`);

          // エラーイベントのハンドリングを追加
          tunnel.on('error', (err) => {
            console.error('Localtunnelエラー:', err.message);
            console.log('Localtunnelエラーが発生しましたが、サーバーは引き続き実行されます');
          });

          // 接続が閉じられたときのハンドリング
          tunnel.on('close', () => {
            console.log('Localtunnel が閉じられました');
          });

          // Discord への投稿処理
          const discordWebhookUrl = process.env.DISCORD_RESULT_WEBHOOK_URL;
          if (discordWebhookUrl) {
            try {
              const message = `Localtunnel URL: ${tunnel.url}`;
              const response = await fetch(discordWebhookUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  content: message,
                }),
              });
              
              if (response.ok) {
                console.log('Discord に投稿しました');
              } else {
                console.error('Discord への投稿に失敗しました:', await response.text());
              }
            } catch (fetchError) {
              console.error('Discord への投稿エラー:', fetchError.message);
            }
          } else {
            console.warn('DISCORD_RESULT_WEBHOOK_URL が設定されていません');
          }
        } catch (tunnelError) {
          console.error('Localtunnelの作成に失敗しました:', tunnelError.message);
          console.log('Localtunnelは使用できませんが、サーバーは引き続き実行されます');
        }
      } else {
        console.error('localtunnelモジュールが正しく読み込まれていません');
      }
    } catch (error) {
      console.error('localtunnel機能の実行中にエラーが発生しました:', error.message);
    }
  } else {
    console.log('localtunnel機能は無効になっています');
  }
});

module.exports = app;
