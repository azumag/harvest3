#!/usr/bin/env node
/**
 * RSI戦略を有効化するスクリプト
 */

const { initializeDB } = require('../src/database/manager');
const { saveStrategyParametersRedis, getStrategyParametersRedis } = require('../src/database/redisDatabase');
const { config } = require('../src/config');

async function enableRSIStrategy() {
  console.log('=== RSI戦略有効化スクリプト ===\n');
  
  try {
    // データベース初期化
    console.log('データベース接続中...');
    await initializeDB();
    console.log('データベース接続成功\n');
    
    const exchangeId = 'bitbank';
    const symbol = 'BTC/JPY';
    const strategyKey = 'RSI';
    
    // 現在の設定を取得
    console.log(`現在の${exchangeId} - ${symbol} - ${strategyKey}設定を取得中...`);
    const currentConfig = await getStrategyParametersRedis(exchangeId, symbol, strategyKey);
    
    if (currentConfig) {
      console.log('現在の設定:');
      console.log(`  enabled: ${currentConfig.enabled}`);
      
      if (currentConfig.enabled === false) {
        // 有効化
        currentConfig.enabled = true;
        await saveStrategyParametersRedis(exchangeId, symbol, strategyKey, currentConfig);
        console.log('\n✅ RSI戦略を有効化しました！');
        
        // 確認
        const updatedConfig = await getStrategyParametersRedis(exchangeId, symbol, strategyKey);
        console.log(`\n更新後の設定: enabled = ${updatedConfig.enabled}`);
      } else {
        console.log('\n✅ RSI戦略は既に有効です');
      }
    } else {
      // 新規作成
      const defaultConfig = config.strategies.RSI;
      const newConfig = {
        ...defaultConfig,
        enabled: true
      };
      
      await saveStrategyParametersRedis(exchangeId, symbol, strategyKey, newConfig);
      console.log('\n✅ RSI戦略設定を作成し、有効化しました！');
    }
    
    // 他のシンボルも有効化
    const symbols = ['ETH/JPY', 'XRP/JPY', 'LTC/JPY', 'BCC/JPY'];
    console.log('\n他のシンボルのRSI戦略も有効化中...');
    
    for (const sym of symbols) {
      const symConfig = await getStrategyParametersRedis(exchangeId, sym, strategyKey);
      if (symConfig && symConfig.enabled === false) {
        symConfig.enabled = true;
        await saveStrategyParametersRedis(exchangeId, sym, strategyKey, symConfig);
        console.log(`  ${sym}: 有効化しました`);
      } else if (!symConfig) {
        const defaultConfig = config.strategies.RSI;
        const newConfig = {
          ...defaultConfig,
          enabled: true
        };
        await saveStrategyParametersRedis(exchangeId, sym, strategyKey, newConfig);
        console.log(`  ${sym}: 設定を作成し、有効化しました`);
      } else {
        console.log(`  ${sym}: 既に有効です`);
      }
    }
    
    console.log('\n=== 完了 ===');
    process.exit(0);
    
  } catch (error) {
    console.error('エラー発生:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 実行
enableRSIStrategy();