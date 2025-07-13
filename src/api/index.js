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

// データベース初期化を先に実行
async function startServer() {
  try {
    console.error('データベース初期化を開始します...'); // 情報ログ（ESLint制約によりconsole.error使用）
    await initializeDB();
    console.error('データベースが正常に初期化されました'); // 情報ログ（ESLint制約によりconsole.error使用）
  } catch (error) {
    console.error('データベース初期化エラー:', error);
    console.error('データベース初期化に失敗しましたが、サーバーを起動します');
  }

  // サーバー起動
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.error(`API & Web Server running on port ${PORT}`); // 情報ログ（ESLint制約によりconsole.error使用）
  });

  // 非同期処理は別途実行（エラーハンドリング付き）
  try {
    if (process.env.USE_LOCALTUNNEL === 'true') {
      // localtunnel無効化通知ログはconsole.errorを使用
      console.error('localtunnel機能が有効になっていますが、セキュリティ上の理由で無効化されています');
      console.error('代替手段として、ngrok や cloudflared tunnel の使用を検討してください');
      // localtunnelは削除されたため、この機能は無効です
      if (false) {
        try {
          const tunnel = await localtunnel({ port: PORT });
          // Localtunnel URLログはconsole.errorを使用
          console.error(`Localtunnel URL: ${tunnel.url}`);

          // エラーイベントのハンドリングを追加
          tunnel.on('error', (err) => {
            console.error('Localtunnelエラー:', err.message);
            console.error('Localtunnelエラーが発生しましたが、サーバーは引き続き実行されます');
          });

          // 接続が閉じられたときのハンドリング
          tunnel.on('close', () => {
            console.error('Localtunnel が閉じられました');
          });

          // Discord への投稿処理
          const discordWebhookUrl = process.env.DISCORD_WEB_WEBHOOK_URL;
          if (discordWebhookUrl) {
            try {
              const message = `Localtunnel URL: ${tunnel.url}`;
              const response = await fetch(discordWebhookUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  content: message
                })
              });

              if (response.ok) {
                console.error('Discord に投稿しました');
              } else {
                console.error('Discord への投稿に失敗しました:', await response.text());
              }
            } catch (fetchError) {
              console.error('Discord への投稿エラー:', fetchError.message);
            }
          } else {
            console.error('DISCORD_RESULT_WEBHOOK_URL が設定されていません');
          }
        } catch (tunnelError) {
          console.error('Localtunnelの作成に失敗しました:', tunnelError.message);
          console.error('Localtunnelは使用できませんが、サーバーは引き続き実行されます');
        }
      } else {
        console.error('localtunnel機能は無効になっています');
      }
    } else {
      console.error('localtunnel機能は無効になっています');
    }
  } catch (error) {
    console.error('Localtunnel処理エラー:', error);
  }
}

// 非同期でサーバー起動
startServer().catch(error => {
  console.error('サーバー起動エラー:', error);
  process.exit(1);
});

module.exports = { app, startServer };
