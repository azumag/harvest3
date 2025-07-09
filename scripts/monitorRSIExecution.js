#!/usr/bin/env node
/**
 * RSI戦略の実行監視スクリプト
 * 最新のシグナルとログを表示
 */

const { initializeDB, listSignals } = require('../src/database/manager');

async function monitorRSIExecution() {
  console.log('=== RSI戦略実行監視 ===\n');

  try {
    // データベース初期化
    await initializeDB();

    // 最新のRSIシグナルを取得
    const signals = await listSignals({
      limit: 20,
      sort: { timestamp: -1 }
    });

    const rsiSignals = signals.filter(signal => signal.strategyKey === 'RSI');

    if (rsiSignals.length === 0) {
      console.log('RSIシグナルがまだ生成されていません。');
      console.log('\nボットが実行中であることを確認してください:');
      console.log('  node bot.js');
      console.log('\nまたは特定のシンボルでRSI戦略のみを実行:');
      console.log('  node bot.js --RSI --symbol BTC/JPY');
    } else {
      console.log(`最新のRSIシグナル (${rsiSignals.length}件):\n`);

      rsiSignals.forEach((signal, index) => {
        const date = new Date(signal.timestamp);
        console.log(`${index + 1}. ${date.toLocaleString('ja-JP')}`);
        console.log(`   シンボル: ${signal.symbol}`);
        console.log(`   シグナル: ${signal.signal}`);
        console.log(`   価格: ${signal.price}`);
        console.log(`   RSI値: ${signal.results?.rsi?.toFixed(2) || 'N/A'}`);
        console.log(`   取引所: ${signal.exchange}`);
        console.log('---');
      });
    }

    // 全体のシグナル統計
    console.log('\n=== シグナル統計 ===');
    const strategyStats = {};
    signals.forEach(signal => {
      if (!strategyStats[signal.strategyKey]) {
        strategyStats[signal.strategyKey] = {
          total: 0,
          buy: 0,
          sell: 0,
          none: 0
        };
      }
      strategyStats[signal.strategyKey].total++;
      strategyStats[signal.strategyKey][signal.signal]++;
    });

    Object.entries(strategyStats).forEach(([strategy, stats]) => {
      console.log(`${strategy}: 合計${stats.total}件 (買い:${stats.buy}, 売り:${stats.sell}, なし:${stats.none})`);
    });

  } catch (error) {
    console.error('エラー発生:', error.message);
    console.error(error.stack);
  }

  process.exit(0);
}

// 実行
monitorRSIExecution();