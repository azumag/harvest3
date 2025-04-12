/**
 * Redis版のイベント処理コントローラー
 */
const redis = require('redis');

// クライアント接続を保持する配列
const clients = [];

// 接続クライアント数の制限
const MAX_CLIENTS = 100;

// Redis Pub/Subサブスクライバー
let subscriber = null;

// SSEハンドラー
async function eventsHandler(req, res) {
  // クライアント数上限チェック
  if (clients.length >= MAX_CLIENTS) {
    res.status(503).json({ error: 'サーバーの接続数上限に達しました。後でお試しください。' });
    return;
  }

  // SSEヘッダーを設定
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // クライアントにPingを送信（接続維持用）
  const pingInterval = setInterval(() => {
    res.write('event: ping\ndata: {}\n\n');
  }, 30000);

  // 新しいクライアントとして登録
  const clientId = Date.now();
  const newClient = {
    id: clientId,
    res
  };
  clients.push(newClient);

  // 接続時に初期データを送信
  sendInitialData(newClient);

  // クライアントが切断したときの処理
  req.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    clearInterval(pingInterval);
    // クライアントリストから削除
    clients.splice(clients.findIndex(client => client.id === clientId), 1);
  });
}

// 初期データ送信
function sendInitialData(client) {
  try {
    // 接続時にはクライアントに接続完了通知を送信
    const connectEvent = {
      type: 'connected',
      data: {
        message: 'リアルタイム更新に接続しました',
        timestamp: Date.now()
      }
    };
    client.res.write(`data: ${JSON.stringify(connectEvent)}\n\n`);
  } catch (error) {
    console.error('初期データ送信エラー:', error);
  }
}

// 全クライアントにデータ送信
function sendEventToAll(eventData) {
  clients.forEach(client => {
    try {
      client.res.write(`data: ${JSON.stringify(eventData)}\n\n`);
    } catch (error) {
      console.error(`クライアント ${client.id} へのイベント送信エラー:`, error);
    }
  });
}

// Redis Pub/Subの初期化
async function initializePubSub() {
  try {
    // すでに初期化されている場合は何もしない
    if (subscriber) return;
    
    // サブスクライバークライアントを作成
    subscriber = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    // サブスクライバーを接続
    await subscriber.connect();
    
    // イベントチャネルをサブスクライブ
    await subscriber.subscribe('trade_events', (message) => {
      try {
        const event = JSON.parse(message);
        sendEventToAll(event);
      } catch (error) {
        console.error('イベントメッセージのパースエラー:', error);
      }
    });
    
    console.log('イベントコントローラーのPub/Subが初期化されました');
  } catch (error) {
    console.error('イベントコントローラーのPub/Sub初期化エラー:', error);
  }
}

// Redis Pub/Subの終了
async function closePubSub() {
  if (subscriber) {
    try {
      await subscriber.unsubscribe('trade_events');
      await subscriber.quit();
      subscriber = null;
      console.log('イベントコントローラーのPub/Subが終了しました');
    } catch (error) {
      console.error('イベントコントローラーのPub/Sub終了エラー:', error);
    }
  }
}

// 初期化を実行
initializePubSub();

module.exports = {
  eventsHandler,
  sendEventToAll,
  initializePubSub,
  closePubSub
};