# リアルタイムデータ更新機能の実装詳細

## 1. 技術選定

リアルタイム更新を実現するため、以下の技術を採用します：

- **Server-Sent Events (SSE)**: サーバーからクライアントへの単方向通信に最適
- 利点:
  - WebSocketよりも実装が簡単
  - HTTP上で動作するため、プロキシやファイアウォールとの互換性が高い
  - 自動再接続機能が標準でサポートされている

## 2. バックエンド実装

### 2.1 SSEエンドポイント

```javascript
// src/api/controllers/events.js
const express = require('express');
const { getTradeRecordsAsObject } = require('../../database');

// クライアント接続を保持する配列
const clients = [];

// SSEハンドラー
function eventsHandler(req, res) {
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

  // クライアントが切断したときの処理
  req.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    clearInterval(pingInterval);
    // クライアントリストから削除
    clients.splice(clients.findIndex(client => client.id === clientId), 1);
  });
}

// 全クライアントにデータ送信
function sendEventToAll(eventData) {
  clients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(eventData)}\n\n`);
  });
}

module.exports = {
  eventsHandler,
  sendEventToAll
};
```

### 2.2 データベース変更通知機能

```javascript
// src/database.js に追加

// データ変更イベントリスナー
const eventListeners = [];

// イベントリスナー登録関数
function addEventListner(callback) {
  eventListeners.push(callback);
}

// 取引追加時にイベント発火するよう修正
const addTrade = db.transaction((exchangeId, symbol, strategyKey, side, amount, price, value) => {
  // 既存のコード...
  
  // イベント通知
  eventListeners.forEach(callback => {
    callback({
      type: 'trade_added',
      data: {
        exchangeId,
        symbol,
        strategyKey,
        side, 
        amount,
        price,
        value,
        timestamp: now
      }
    });
  });
});

module.exports = {
  // 既存のエクスポート...
  addEventListner
};
```

### 2.3 APIルートの追加

```javascript
// src/api/routes.js に追加
const eventsController = require('./controllers/events');

// SSEエンドポイント
router.get('/events', eventsController.eventsHandler);
```

### 2.4 トレード更新イベントの統合

```javascript
// src/api/index.js に追加
const { addEventListner } = require('../database');
const { sendEventToAll } = require('./controllers/events');

// トレード更新イベントをSSEで通知
addEventListner((event) => {
  sendEventToAll(event);
});
```

## 3. フロントエンド実装

### 3.1 EventSourceによるSSE接続

```javascript
// src/web/js/realtime.js
class RealtimeUpdater {
  constructor() {
    this.eventSource = null;
    this.listeners = {
      'trade_added': []
    };
  }

  // SSE接続を開始
  connect() {
    if (this.eventSource) {
      this.disconnect();
    }
    
    this.eventSource = new EventSource('/api/events');
    
    // 接続イベント
    this.eventSource.onopen = () => {
      console.log('リアルタイム更新に接続しました');
    };
    
    // メッセージ受信イベント
    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // イベントタイプに応じたリスナーを呼び出し
      if (this.listeners[data.type]) {
        this.listeners[data.type].forEach(callback => callback(data.data));
      }
    };
    
    // エラーイベント
    this.eventSource.onerror = (error) => {
      console.error('SSE接続エラー:', error);
      this.eventSource.close();
      
      // 5秒後に再接続
      setTimeout(() => this.connect(), 5000);
    };
  }
  
  // イベントリスナーを追加
  addListener(eventType, callback) {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType].push(callback);
  }
  
  // 接続を閉じる
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// グローバルインスタンス
const realtimeUpdater = new RealtimeUpdater();
```

### 3.2 ダッシュボードへの統合

```javascript
// src/web/js/dashboard.js
document.addEventListener('DOMContentLoaded', () => {
  // 初期データ読み込み
  loadDashboardData();
  
  // リアルタイム更新を開始
  realtimeUpdater.connect();
  
  // 新規取引イベントをリッスン
  realtimeUpdater.addListener('trade_added', (tradeData) => {
    // ポジションカードを更新
    updatePositionCard(tradeData.exchangeId, tradeData.symbol, tradeData.strategyKey);
    
    // 最近の取引テーブルに追加
    addTradeToRecentTable(tradeData);
    
    // グラフを更新
    updateCharts();
  });
});

// ポジションカード更新関数
function updatePositionCard(exchangeId, symbol, strategyKey) {
  fetch(`/api/positions?exchangeId=${exchangeId}&symbol=${symbol}&strategyKey=${strategyKey}`)
    .then(response => response.json())
    .then(data => {
      // 該当するカードを特定して内容を更新
      const positionCard = document.querySelector(`#position-card-${exchangeId}-${symbol}-${strategyKey}`);
      if (positionCard) {
        // カード内容を更新する処理
        // ...
      }
    });
}

// 最近の取引テーブルに行を追加
function addTradeToRecentTable(trade) {
  const table = document.getElementById('recent-trades-table');
  const tbody = table.querySelector('tbody');
  
  // 新しい行を先頭に追加
  const newRow = document.createElement('tr');
  newRow.innerHTML = `
    <td>${new Date(trade.timestamp).toLocaleString()}</td>
    <td>${trade.exchangeId}</td>
    <td>${trade.symbol}</td>
    <td>${trade.strategyKey}</td>
    <td class="${trade.side === 'buy' ? 'text-success' : 'text-danger'}">${trade.side}</td>
    <td>${trade.amount}</td>
    <td>${trade.price.toLocaleString()}</td>
    <td>${trade.value.toLocaleString()}</td>
  `;
  
  // テーブルの先頭に挿入
  if (tbody.firstChild) {
    tbody.insertBefore(newRow, tbody.firstChild);
  } else {
    tbody.appendChild(newRow);
  }
  
  // 行数が多すぎる場合は古い行を削除
  const maxRows = 100;
  while (tbody.children.length > maxRows) {
    tbody.removeChild(tbody.lastChild);
  }
}
```

### 3.3 取引履歴ページへの統合

```javascript
// src/web/js/history.js
document.addEventListener('DOMContentLoaded', () => {
  // DataTablesインスタンス
  const tradesTable = $('#trades-history-table').DataTable({
    // 設定省略...
  });
  
  // リアルタイム更新を開始
  realtimeUpdater.connect();
  
  // 新規取引イベントをリッスン
  realtimeUpdater.addListener('trade_added', (tradeData) => {
    // DataTablesに新しい行を追加
    tradesTable.row.add([
      new Date(tradeData.timestamp).toLocaleString(),
      tradeData.exchangeId,
      tradeData.symbol,
      tradeData.strategyKey,
      tradeData.side,
      tradeData.amount,
      tradeData.price.toLocaleString(),
      tradeData.value.toLocaleString()
    ]).draw(false);
  });
});
```

### 3.4 分析ページへの統合

```javascript
// src/web/js/analysis.js
document.addEventListener('DOMContentLoaded', () => {
  // チャートインスタンス
  const charts = initializeCharts();
  
  // リアルタイム更新を開始
  realtimeUpdater.connect();
  
  // 新規取引イベントをリッスン
  realtimeUpdater.addListener('trade_added', (tradeData) => {
    // 定期的に全チャートを更新（頻繁すぎる更新を避けるため）
    if (!charts.updateScheduled) {
      charts.updateScheduled = true;
      setTimeout(() => {
        updateAllCharts(charts);
        charts.updateScheduled = false;
      }, 5000); // 5秒ごとに最大1回更新
    }
  });
});
```

## 4. Docker設定の調整

### 4.1 docker-compose.yml の更新

```yaml
services:
  # 既存のサービス...

  web-ui:
    # 既存の設定...
    environment:
      - NODE_ENV=production
      - PORT=3000
      - ENABLE_REALTIME=true  # リアルタイム更新を有効化
```

### 4.2 パフォーマンス最適化

大量のクライアント接続に対応するための調整:

1. **クライアントの制限**: 大量の接続があった場合にサーバーリソースを保護
2. **効率的なイベント配信**: 全クライアントに同じデータを送る際の最適化
3. **帯域制限**: 過剰なイベント発生時の制御

```javascript
// src/api/controllers/events.js に追加

// 接続クライアント数の制限
const MAX_CLIENTS = 100;

// イベント送信の調整用（短期間に大量のイベントが発生した場合の対策）
let pendingEvents = [];
let sendTimeout = null;

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

// eventsHandler関数を修正
function eventsHandler(req, res) {
  // クライアント数上限チェック
  if (clients.length >= MAX_CLIENTS) {
    res.status(503).json({ error: 'サーバーの接続数上限に達しました。後でお試しください。' });
    return;
  }
  
  // 以下は既存のコード...
}
```

## 5. セキュリティ考慮事項

リアルタイム接続におけるセキュリティ対策:

1. **レート制限**: 同一IPからの過剰な接続リクエストを制限
2. **認証**: 必要に応じてSSE接続に認証を追加
3. **データフィルタリング**: 機密情報が含まれないよう送信データを検証

```javascript
// src/api/controllers/events.js に追加（認証例）

// 認証済みクライアントのみ接続可能にする場合
function eventsHandler(req, res) {
  // 認証チェック（例）
  if (!req.session || !req.session.authenticated) {
    res.status(401).json({ error: '認証が必要です' });
    return;
  }
  
  // 以下は既存のコード...
}