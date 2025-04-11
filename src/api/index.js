const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const routes = require('./routes');
const { addEventListner } = require('./database-events');
const { sendEventToAll } = require('./controllers/events');

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
app.use('/api', routes);

// メインHTMLルート
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

// データベースイベントをSSEで配信
addEventListner((event) => {
  sendEventToAll(event);
});

app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/history.html'));
});

app.get('/analysis', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/analysis.html'));
});

// サーバー起動
app.listen(PORT, () => {
  console.log(`API & Web Server running on port ${PORT}`);
});

module.exports = app;