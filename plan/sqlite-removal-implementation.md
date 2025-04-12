# SQLite削除の実装手順

このドキュメントでは、SQLite関連のコードを削除し、Redisのみを使用するための具体的な実装手順を説明します。

## 1. ファイル削除

以下のコマンドを実行して、SQLite関連のファイルを削除します：

```bash
# SQLiteデータベース関連ファイルの削除
rm src/database.js
rm src/tradeRecords.js
rm src/api/routes.js
rm src/api/database-events.js
rm src/api/controllers/positions.js
rm src/api/controllers/history.js
rm src/api/controllers/summary.js
rm src/api/controllers/events.js
rm scripts/migrateToSqlite.js
rm test/testSqlite.js
```

## 2. ファイル修正

### 2.1 dbConfig.jsの修正

`src/dbConfig.js`ファイルを以下の内容に置き換えます：

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

### 2.2 package.jsonの修正

`package.json`ファイルを編集して、SQLite関連の依存関係とスクリプトを削除します：

1. `better-sqlite3`依存関係を削除
2. `migrate-to-sqlite`と`test-sqlite`スクリプトを削除

修正後の`package.json`の関連部分は以下のようになります：

```json
{
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

### 2.3 strategyRunner.jsの修正

`src/strategyRunner.js`ファイルの冒頭部分を修正して、`redisTradeRecords.js`をインポートするようにします：

```javascript
const strategies = require('../strategies');
const { config, bitflyerMinTradeAmounts } = require('./config');
const { updateTradeRecord, tradeRecords } = require('./redisTradeRecords');
const { postErrorToDiscord, postOrderToDiscord } = require('./notifications');
const { getMarketParameters } = require('./utils');
```

### 2.4 .env.exampleの修正

`.env.example`ファイルから`USE_REDIS`環境変数の行を削除します。

## 3. 依存関係の更新

パッケージの依存関係を更新します：

```bash
npm uninstall better-sqlite3
npm install
```

## 4. 検証

以下のコマンドを実行して、アプリケーションが正常に動作することを確認します：

```bash
# Webサーバーを起動
npm run start-web

# ボットを起動
npm start
```

## 5. データベースファイルのクリーンアップ

SQLiteデータベースファイルを削除します：

```bash
rm -f data/trade_records.db*
```

## 6. コードベースの確認

プロジェクト全体を検索して、SQLite関連の参照が残っていないか確認します：

```bash
grep -r "database\.js" --include="*.js" .
grep -r "tradeRecords\.js" --include="*.js" .
grep -r "better-sqlite3" --include="*.js" .
```

## 7. ドキュメントの更新

プロジェクトのREADMEやその他のドキュメントを更新して、SQLiteへの言及を削除し、Redisのみを使用していることを明記します。

## 8. 実装のためのコードモードへの切り替え

この計画を実装するには、Codeモードに切り替えることをお勧めします。Codeモードでは、上記の変更を効率的に実装できます。

```
switch_mode code "SQLite関連コードの削除と修正を実装するため"
```

## 9. トラブルシューティング

実装中に問題が発生した場合は、以下の点を確認してください：

1. Redisサーバーが実行されていることを確認
2. 環境変数が正しく設定されていることを確認
3. すべての依存関係が正しくインストールされていることを確認
4. アプリケーションのログを確認して、エラーメッセージを特定

---

この手順に従うことで、プロジェクトからSQLite関連のコードを完全に削除し、Redisのみを使用するように変更できます。