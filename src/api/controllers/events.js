// クライアント接続を保持する配列
const clients = [];

// 接続クライアント数の制限
const MAX_CLIENTS = 100;

// イベント送信の調整用（短期間に大量のイベントが発生した場合の対策）
let pendingEvents = [];
let sendTimeout = null;

// SSEハンドラー
function eventsHandler(req, res) {
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

// イベント送信をスケジュール
function scheduleEventDelivery(eventData) {
  pendingEvents.push(eventData);
  
  // すでにタイマーがセットされていない場合のみ設定
  if (!sendTimeout) {
    sendTimeout = setTimeout(() => {
      // 蓄積したイベントをまとめて送信
      if (pendingEvents.length > 0) {
        const batchEvent = {
          type: 'batch_update',
          data: pendingEvents
        };
        sendEventToAll(batchEvent);
        pendingEvents = [];
      }
      sendTimeout = null;
    }, 300); // 300ミリ秒間隔でバッチ処理
  }
}

module.exports = {
  eventsHandler,
  sendEventToAll,
  scheduleEventDelivery
};