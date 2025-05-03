# SQLite廃止計画

このドキュメントでは、プロジェクトからSQLite関連のコードを完全に削除し、Redisのみを使用するようにするための計画を詳述します。

## 1. 削除すべきファイル

以下のSQLite関連ファイルを削除します：

- `src/database.js` - SQLiteデータベース操作のメインファイル
- `src/tradeRecords.js` - SQLiteを使用した取引記録管理
- `src/api/routes.js` - SQLite用のAPIルート
- `src/api/database-events.js` - SQLite用のデータベースイベント
- `src/api/controllers/positions.js` - SQLite用のポジションコントローラー
- `src/api/controllers/history.js` - SQLite用の履歴コントローラー
- `src/api/controllers/summary.js` - SQLite用のサマリーコントローラー
- `src/api/controllers/events.js` - SQLite用のイベントコントローラー
- `scripts/migrateToSqlite.js` - メモリからSQLiteへの移行スクリプト
- `test/testSqlite.js` - SQLiteのテストファイル

## 2. 修正すべきファイル

### 2.1 `src/dbConfig.js`の修正

`dbConfig.js`ファイルを修正して、環境変数`USE_REDIS`の使用を削除し、常にRedisを使用するように変更します。

```javascript
/**
 * データベース設定モジュール
 * Redisのみを使用するように修正
 */

// データベースモジュールをインポート
const redisDatabase = require('./redisDatabase');
const redisTradeRecords = require('./redisTradeRecords');
const redisRoutes = require('./api/redis-routes');
const redisDatabaseEvents = require('./api/redis-database-events');

// 常にRedisを使用するようにエクスポート
const database = redisDatabase;
const tradeRecords = redisTradeRecords;
const apiRoutes = redisRoutes;
const databaseEvents = redisDatabaseEvents;

// 初期化関数
async function initialize() {
  console.log('Redisデータベースを使用します');
  await redisDatabase.initialize();
  if (typeof redisTradeRecords.initializeCache === 'function') {
    await redisTradeRecords.initializeCache();
  }
}

module.exports = {
  database,
  tradeRecords,
  apiRoutes,
  databaseEvents,
  initialize
};
```

### 2.2 `package.json`の修正

`package.json`ファイルからSQLite関連の依存関係とスクリプトを削除します。

```json
{
  "name": "scalping-bot",
  "version": "1.0.0",
  "description": "Bitcoin scalping bot using ccxt and Docker",
  "main": "bot.js",
  "scripts": {
    "start": "node bot.js",
    "start-hft": "node src/hftBot.js",
    "start-mm": "node src/mmBot.js",
    "start-web": "node src/api/index.js",
    "close-all": "node src/closeAllPositions.js",
    "close-bb": "node src/closeAllPositions.js --bitbank",
    "close-bf": "node src/closeAllPositions.js --bitflyer",
    "check-order-status": "node test/checkOrderStatus.js"
  },
  "dependencies": {
    "axios": "^1.7.7",
    "ccxt": "^3.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.5.0",
    "express": "^4.18.2",
    "localtunnel": "^2.0.2",
    "morgan": "^1.10.0",
    "node-fetch": "^2.6.7",
    "redis": "^4.7.0"
  }
}
```

### 2.3 `.env.example`の修正

`.env.example`ファイルから`USE_REDIS`環境変数を削除します。

## 3. 参照の修正

### 3.1 `src/strategyRunner.js`の修正

`strategyRunner.js`ファイルで`tradeRecords.js`をインポートしている箇所を`redisTradeRecords.js`に変更します。

```javascript
// 変更前
const { updateTradeRecord, tradeRecords } = require('./tradeRecords');

// 変更後
const { updateTradeRecord, tradeRecords } = require('./redisTradeRecords');
```

### 3.2 その他のファイルの修正

プロジェクト内で`tradeRecords.js`や`database.js`を参照している他のファイルも同様に修正します。

## 4. 実行手順

1. プロジェクトのバックアップを作成します
2. 上記の修正を順番に実施します
3. 不要なファイルを削除します
4. アプリケーションを起動してテストします

## 5. 検証方法

1. アプリケーションが正常に起動することを確認します
2. Redisデータベースに接続できることを確認します
3. 取引記録の取得や更新が正常に行えることを確認します
4. APIエンドポイントが正常に動作することを確認します

## 6. ロールバック計画

問題が発生した場合は、バックアップから復元します。

---

この計画を実行することで、プロジェクトからSQLite関連のコードを完全に削除し、Redisのみを使用するように変更できます。