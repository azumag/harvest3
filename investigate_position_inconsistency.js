#!/usr/bin/env node

/**
 * リスク管理ポジション数と注文・約定数の不整合調査スクリプト
 */

const { initRedisClient } = require('./src/database/redisClient');
const { getAllPositionsRedis } = require('./src/database/redisDatabase');
const { listOrders, listTrades, connectDB } = require('./src/database/mongoDatabase');
const { config } = require('./src/config');

async function investigateInconsistency() {
  try {
    console.log('🔍 リスク管理ポジション数と注文・約定数の不整合調査を開始します...\n');

    await initRedisClient();
    await connectDB();

    // 1. Redisのリスク管理ポジションデータを取得
    console.log('1. Redisのリスク管理ポジション情報を調査中...');
    const riskPositions = await getAllPositionsRedis();
    console.log(`   総ポジション数: ${riskPositions.length}件`);
    
    if (riskPositions.length > 0) {
      console.log('   ポジション詳細:');
      riskPositions.forEach((pos, index) => {
        console.log(`     ${index + 1}. ${pos.exchangeId}:${pos.symbol}:${pos.strategyKey} OrderID:${pos.orderId}`);
        console.log(`        Amount: ${pos.amount}, Status: ${pos.status}, Created: ${new Date(pos.createdAt).toLocaleString()}`);
        console.log(`        Entry Price: ${pos.entryPrice}, Highest: ${pos.highestPrice}`);
      });
    }

    // 2. MongoDBの注文データを取得（最近7日間）
    console.log('\n2. MongoDBの注文データを調査中...');
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const recentOrders = await listOrders(
      { timestamp: { $gte: weekAgo } }, 
      { sort: { timestamp: -1 } }
    );
    console.log(`   最近7日間の注文数: ${recentOrders.length}件`);
    
    // 注文を戦略別・サイド別に集計
    const ordersByStrategy = {};
    recentOrders.forEach(order => {
      const key = `${order.exchange}:${order.symbol}:${order.strategy}`;
      if (!ordersByStrategy[key]) {
        ordersByStrategy[key] = { buy: [], sell: [] };
      }
      ordersByStrategy[key][order.side].push(order);
    });

    console.log('   戦略別注文数:');
    Object.entries(ordersByStrategy).forEach(([key, orders]) => {
      console.log(`     ${key}: Buy:${orders.buy.length}件, Sell:${orders.sell.length}件`);
    });

    // 3. MongoDBの約定データを取得（最近7日間）
    console.log('\n3. MongoDBの約定データを調査中...');
    const recentTrades = await listTrades(
      { timestamp: { $gte: weekAgo } }, 
      { sort: { timestamp: -1 } }
    );
    console.log(`   最近7日間の約定数: ${recentTrades.length}件`);
    
    // 約定を戦略別・サイド別に集計
    const tradesByStrategy = {};
    recentTrades.forEach(trade => {
      const key = `${trade.exchange}:${trade.symbol}:${trade.strategy}`;
      if (!tradesByStrategy[key]) {
        tradesByStrategy[key] = { buy: [], sell: [] };
      }
      tradesByStrategy[key][trade.side].push(trade);
    });

    console.log('   戦略別約定数:');
    Object.entries(tradesByStrategy).forEach(([key, trades]) => {
      console.log(`     ${key}: Buy:${trades.buy.length}件, Sell:${trades.sell.length}件`);
    });

    // 4. リスク管理ポジションと注文・約定の関連付け調査
    console.log('\n4. データ関連付けの分析中...');
    
    for (const pos of riskPositions) {
      const posKey = `${pos.exchangeId}:${pos.symbol}:${pos.strategyKey}`;
      console.log(`\n   🔍 ポジション: ${posKey} (OrderID: ${pos.orderId})`);
      
      // このポジションに対応する注文を検索
      const relatedOrders = recentOrders.filter(order => 
        order.exchange === pos.exchangeId &&
        order.symbol === pos.symbol &&
        order.strategy === pos.strategyKey &&
        order.orderId === pos.orderId
      );
      
      console.log(`     関連注文: ${relatedOrders.length}件`);
      relatedOrders.forEach(order => {
        console.log(`       - ${order.side} ${order.amount} @ ${order.price} (${new Date(order.timestamp).toLocaleString()})`);
      });
      
      // このポジションに対応する約定を検索
      const relatedTrades = recentTrades.filter(trade => 
        trade.exchange === pos.exchangeId &&
        trade.symbol === pos.symbol &&
        trade.strategy === pos.strategyKey &&
        trade.orderId === pos.orderId
      );
      
      console.log(`     関連約定: ${relatedTrades.length}件`);
      relatedTrades.forEach(trade => {
        console.log(`       - ${trade.side} ${trade.amount} @ ${trade.price} (${new Date(trade.timestamp).toLocaleString()})`);
      });
      
      // ポジション状態の整合性チェック
      if (relatedOrders.length === 0 && relatedTrades.length === 0) {
        console.log(`     ⚠️ 警告: このポジションに対応する注文・約定データが見つかりません（孤立ポジション）`);
      }
      
      if (pos.status === 'open' && relatedTrades.some(t => t.side === 'sell')) {
        console.log(`     ⚠️ 警告: オープンポジションなのに売り約定が存在します`);
      }
    }

    // 5. 取引所の実際の注文状況を確認
    console.log('\n5. 取引所の実際の注文状況を確認中...');
    const exchange = config.exchanges.bitbank.instance;
    
    // 主要通貨ペアの注文状況をチェック
    const symbols = ['OMG/JPY', 'ETH/JPY', 'BTC/JPY', 'LPT/JPY'];
    for (const symbol of symbols) {
      try {
        const openOrders = await exchange.fetchOpenOrders(symbol);
        if (openOrders.length > 0) {
          console.log(`   ${symbol}: ${openOrders.length}件のオープン注文`);
          openOrders.forEach(order => {
            console.log(`     - ${order.side} ${order.amount} @ ${order.price} (ID: ${order.id})`);
          });
        }
      } catch (error) {
        console.log(`   ${symbol}: 注文取得エラー - ${error.message}`);
      }
    }

    // 6. 不整合パターンの特定
    console.log('\n6. 不整合パターンの分析...');
    
    // パターン1: リスク管理ポジションはあるが注文・約定がない
    const orphanedPositions = riskPositions.filter(pos => {
      const hasRelatedOrder = recentOrders.some(order => 
        order.orderId === pos.orderId &&
        order.exchange === pos.exchangeId &&
        order.symbol === pos.symbol
      );
      const hasRelatedTrade = recentTrades.some(trade => 
        trade.orderId === pos.orderId &&
        trade.exchange === pos.exchangeId &&
        trade.symbol === pos.symbol
      );
      return !hasRelatedOrder && !hasRelatedTrade;
    });
    
    if (orphanedPositions.length > 0) {
      console.log(`   🚨 孤立ポジション: ${orphanedPositions.length}件`);
      orphanedPositions.forEach(pos => {
        console.log(`     - ${pos.exchangeId}:${pos.symbol}:${pos.strategyKey} (OrderID: ${pos.orderId})`);
      });
    }
    
    // パターン2: 注文・約定はあるがリスク管理ポジションがない
    const uniqueOrderIds = [...new Set(recentOrders.map(o => o.orderId))];
    const uniqueTradeOrderIds = [...new Set(recentTrades.map(t => t.orderId))];
    const allOrderIds = [...new Set([...uniqueOrderIds, ...uniqueTradeOrderIds])];
    
    const missingPositions = allOrderIds.filter(orderId => {
      return !riskPositions.some(pos => pos.orderId === orderId);
    });
    
    if (missingPositions.length > 0) {
      console.log(`   🚨 ポジション記録漏れ: ${missingPositions.length}件の注文ID`);
      missingPositions.slice(0, 10).forEach(orderId => { // 最初の10件のみ表示
        const relatedOrder = recentOrders.find(o => o.orderId === orderId);
        const relatedTrade = recentTrades.find(t => t.orderId === orderId);
        const item = relatedOrder || relatedTrade;
        if (item) {
          console.log(`     - OrderID: ${orderId} (${item.exchange}:${item.symbol}:${item.strategy})`);
        }
      });
      if (missingPositions.length > 10) {
        console.log(`     ... 他 ${missingPositions.length - 10}件`);
      }
    }

    // 7. データの時系列分析
    console.log('\n7. データの時系列分析...');
    const now = Date.now();
    const timeRanges = [
      { name: '1時間以内', start: now - 60 * 60 * 1000 },
      { name: '24時間以内', start: now - 24 * 60 * 60 * 1000 },
      { name: '7日以内', start: now - 7 * 24 * 60 * 60 * 1000 },
    ];
    
    timeRanges.forEach(range => {
      const ordersInRange = recentOrders.filter(o => o.timestamp >= range.start);
      const tradesInRange = recentTrades.filter(t => t.timestamp >= range.start);
      const positionsInRange = riskPositions.filter(p => p.createdAt >= range.start);
      
      console.log(`   ${range.name}:`);
      console.log(`     注文: ${ordersInRange.length}件, 約定: ${tradesInRange.length}件, ポジション: ${positionsInRange.length}件`);
    });

    console.log('\n✅ 調査完了');

  } catch (error) {
    console.error('❌ 調査中にエラーが発生しました:', error);
  } finally {
    process.exit(0);
  }
}

investigateInconsistency().catch(console.error);