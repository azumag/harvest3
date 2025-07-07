#!/usr/bin/env node
/**
 * RSI戦略の実行テストスクリプト
 * データベース接続と戦略設定の確認
 */

const { config } = require('../src/config');
const { getStrategyConfig, initializeDB } = require('../src/database/manager');

async function testRSIStrategy() {
  console.log('=== RSI戦略実行テスト開始 ===\n');
  
  try {
    // データベース初期化
    console.log('1. データベース接続テスト...');
    await initializeDB();
    console.log('✅ データベース接続成功\n');
    
    // RSI戦略設定確認
    console.log('2. RSI戦略設定確認...');
    const rsiStrategy = config.strategies.RSI;
    console.log('RSI戦略基本設定:');
    console.log(`  - 有効状態: ${rsiStrategy.enabled}`);
    console.log(`  - タイプ: ${rsiStrategy.type}`);
    console.log(`  - 期間: ${rsiStrategy.period}`);
    console.log(`  - 売られ過ぎ閾値: ${rsiStrategy.oversoldThreshold}`);
    console.log(`  - 買われ過ぎ閾値: ${rsiStrategy.overboughtThreshold}`);
    console.log(`  - OHLCVインターバル: ${rsiStrategy.ohlcvInterval}`);
    console.log(`  - 関数名: ${rsiStrategy.function ? rsiStrategy.function.name : 'undefined'}`);
    console.log('');
    
    // 個別設定の確認
    console.log('3. 個別戦略設定の確認...');
    const exchangeId = 'bitbank';
    const symbol = 'BTC/JPY';
    const strategyKey = 'RSI';
    
    const exchangeConfig = config.exchanges[exchangeId];
    if (!exchangeConfig) {
      throw new Error(`Exchange ${exchangeId} not found in config`);
    }
    
    const strategyConfig = await getStrategyConfig(
      exchangeConfig.instance, 
      symbol, 
      strategyKey, 
      config
    );
    
    console.log(`${exchangeId} - ${symbol} のRSI戦略設定:`);
    console.log(JSON.stringify(strategyConfig, null, 2));
    console.log('');
    
    // 戦略実行可能性チェック
    console.log('4. 戦略実行可能性チェック...');
    if (!rsiStrategy.enabled) {
      console.log('❌ RSI戦略は無効化されています（config.strategies.RSI.enabled = false）');
    } else if (!strategyConfig.enabled) {
      console.log('❌ RSI戦略は個別設定で無効化されています');
    } else if (!rsiStrategy.function) {
      console.log('❌ RSI戦略の実行関数が定義されていません');
    } else {
      console.log('✅ RSI戦略は実行可能です');
    }
    
    console.log('\n=== テスト完了 ===');
    
  } catch (error) {
    console.error('エラー発生:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
  
  process.exit(0);
}

// 実行
testRSIStrategy();