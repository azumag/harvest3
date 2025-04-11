const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// データディレクトリが存在しない場合は作成
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// データベース接続
const db = new Database(path.join(dataDir, 'trade_records.db'));

// WALモードを有効化して性能向上
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// テーブル初期化
function initializeTables() {
  // 取引記録テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exchange_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      strategy_key TEXT NOT NULL,
      buy_amount REAL DEFAULT 0,
      sell_amount REAL DEFAULT 0,
      total_buy_cost REAL DEFAULT 0,
      total_sell_value REAL DEFAULT 0,
      net_position REAL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(exchange_id, symbol, strategy_key)
    )
  `);

  // 取引履歴テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      side TEXT NOT NULL,
      amount REAL NOT NULL,
      price REAL NOT NULL,
      value REAL NOT NULL,
      FOREIGN KEY (record_id) REFERENCES trade_records(id)
    )
  `);

  // インデックスを作成してクエリを高速化
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_trade_records_lookup ON trade_records(exchange_id, symbol, strategy_key);
    CREATE INDEX IF NOT EXISTS idx_trade_history_record_id ON trade_history(record_id);
    CREATE INDEX IF NOT EXISTS idx_trade_history_timestamp ON trade_history(timestamp);
  `);
}

// テーブル初期化を実行
initializeTables();

// よく使われるクエリを準備
const statements = {
  getRecord: db.prepare('SELECT * FROM trade_records WHERE exchange_id = ? AND symbol = ? AND strategy_key = ?'),
  getRecordId: db.prepare('SELECT id FROM trade_records WHERE exchange_id = ? AND symbol = ? AND strategy_key = ?'),
  createRecord: db.prepare(`
    INSERT INTO trade_records 
    (exchange_id, symbol, strategy_key, buy_amount, sell_amount, total_buy_cost, total_sell_value, net_position, created_at, updated_at) 
    VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?, ?)
  `),
  updateRecordBuy: db.prepare(`
    UPDATE trade_records 
    SET buy_amount = buy_amount + ?, 
        total_buy_cost = total_buy_cost + ?, 
        net_position = net_position + ?,
        updated_at = ? 
    WHERE id = ?
  `),
  updateRecordSell: db.prepare(`
    UPDATE trade_records 
    SET sell_amount = sell_amount + ?, 
        total_sell_value = total_sell_value + ?, 
        buy_amount = buy_amount - ?,
        net_position = net_position - ?,
        updated_at = ? 
    WHERE id = ?
  `),
  addTradeHistory: db.prepare(`
    INSERT INTO trade_history 
    (record_id, timestamp, side, amount, price, value) 
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getTradeHistory: db.prepare(`
    SELECT * FROM trade_history 
    WHERE record_id = ? 
    ORDER BY timestamp DESC 
    LIMIT 100
  `),
  getExchangeRecords: db.prepare('SELECT * FROM trade_records WHERE exchange_id = ?'),
  getAllRecords: db.prepare('SELECT * FROM trade_records'),
  getLatestTradeAmount: db.prepare(`
    SELECT th.amount FROM trade_history th
    JOIN trade_records tr ON th.record_id = tr.id
    WHERE tr.exchange_id = ? AND tr.symbol = ? AND tr.strategy_key = ?
    ORDER BY th.timestamp DESC
    LIMIT 1
  `)
};

// トランザクション用関数 - 取引追加
const addTrade = db.transaction((exchangeId, symbol, strategyKey, side, amount, price, value) => {
  const now = Date.now();
  
  // 記録を取得または作成
  let recordId = statements.getRecordId.get(exchangeId, symbol, strategyKey)?.id;
  
  if (!recordId) {
    statements.createRecord.run(exchangeId, symbol, strategyKey, now, now);
    recordId = statements.getRecordId.get(exchangeId, symbol, strategyKey).id;
  }
  
  // 取引履歴を追加
  statements.addTradeHistory.run(recordId, now, side, amount, price, value);
  
  // 記録を更新
  if (side === 'buy') {
    statements.updateRecordBuy.run(amount, value, amount, now, recordId);
  } else if (side === 'sell') {
    const record = statements.getRecord.get(exchangeId, symbol, strategyKey);
    const deductAmount = Math.min(record.buy_amount, amount);
    statements.updateRecordSell.run(amount, value, deductAmount, amount, now, recordId);
  }
});

// メモリオブジェクトとして取引記録を返す
function getTradeRecordsAsObject() {
  const result = {};
  
  const records = statements.getAllRecords.all();
  
  for (const record of records) {
    const { exchange_id, symbol, strategy_key, buy_amount, sell_amount, total_buy_cost, total_sell_value, net_position, id } = record;
    
    // 取引履歴を取得
    const tradeHistory = statements.getTradeHistory.all(id);
    
    // 既存のオブジェクト構造と同じ形式で返す
    if (!result[exchange_id]) {
      result[exchange_id] = {};
    }
    
    if (!result[exchange_id][symbol]) {
      result[exchange_id][symbol] = {};
    }
    
    result[exchange_id][symbol][strategy_key] = {
      buyAmount: buy_amount,
      sellAmount: sell_amount,
      totalBuyCost: total_buy_cost,
      totalSellValue: total_sell_value,
      netPosition: net_position,
      trades: tradeHistory.map(t => ({
        timestamp: t.timestamp,
        side: t.side,
        amount: t.amount,
        price: t.price,
        value: t.value
      }))
    };
  }
  
  return result;
}

// 指定されたexchange、symbol、戦略の組で最新のtradeHistoryのamountを取得
function getLatestTradeAmount(exchangeId, symbol, strategyKey) {
  const result = statements.getLatestTradeAmount.get(exchangeId, symbol, strategyKey);
  return result ? result.amount : 0;
}

module.exports = {
  db,
  statements,
  addTrade,
  getTradeRecordsAsObject,
  getLatestTradeAmount,
  
  // チェックポイント実行関数
  checkpoint: () => {
    console.log('SQLite WALチェックポイントを実行中...');
    try {
      // チェックポイント操作を実行
      const result = db.pragma('wal_checkpoint(FULL)');
      console.log('チェックポイント結果:', result);
      return true;
    } catch (error) {
      console.error('チェックポイント処理中にエラーが発生しました:', error);
      return false;
    }
  }
};