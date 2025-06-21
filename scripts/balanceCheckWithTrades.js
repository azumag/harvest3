#!/usr/bin/env node

/**
 * 約定確認付き残高チェックスクリプト
 * 
 * 未処理の約定を確認・反映してから残高比較を実行
 */

const { initRedisClient } = require('../src/database/redisClient');
const { getTradeSummary } = require('../src/database/redisDatabase');
const { updateFilledTrades } = require('../src/database/manager');
const { config } = require('../src/config');

async function balanceCheckWithTrades() {
  try {
    await initRedisClient();
    console.log('🔄 約定確認付き残高チェック開始');
    console.log('================================================================================');
    
    const exchange = config.exchanges.bitbank.instance;
    const exchangeId = 'bitbank';
    
    // 主要通貨ペア（問題があった通貨を中心に）
    const symbols = [
      'OMG/JPY', 'GALA/JPY', 'OAS/JPY', 'CHZ/JPY', 'AVAX/JPY',
      'DOGE/JPY', 'LTC/JPY', 'XRP/JPY', 'DOT/JPY', 'LINK/JPY',
      'ETH/JPY', 'ADA/JPY', 'APE/JPY', 'SOL/JPY', 'XLM/JPY'
    ];
    
    // 有効な戦略
    const activeStrategies = Object.keys(config.strategies).filter(key => 
      config.strategies[key].enabled
    );
    
    console.log(`📋 対象通貨: ${symbols.length}ペア`);
    console.log(`📋 有効戦略: ${activeStrategies.join(', ')}`);
    console.log('');
    
    // ===== ステップ1: 約定確認と更新 =====
    console.log('⏰ ステップ1: 未処理約定の確認・反映開始');
    console.log('--------------------------------');
    
    let totalTradesProcessed = 0;
    
    for (const symbol of symbols) {
      try {
        console.log(`🔍 ${symbol} の約定確認中...`);
        const tradesCount = await updateFilledTrades(exchange, symbol);
        totalTradesProcessed += tradesCount;
        
        if (tradesCount > 0) {
          console.log(`  ✅ ${tradesCount}件の約定を処理・反映`);
        } else {
          console.log(`  📝 新規約定なし`);
        }
      } catch (error) {
        console.error(`  ❌ ${symbol} 約定確認エラー: ${error.message}`);
      }
    }
    
    console.log('');
    console.log(`📊 約定確認完了: 合計${totalTradesProcessed}件の約定を処理`);
    console.log('');
    
    // ===== ステップ2: 残高取得 =====
    console.log('⏰ ステップ2: 取引所残高取得');
    console.log('------------------------');
    
    const balance = await exchange.fetchBalance();
    console.log('✅ 取引所残高取得完了');
    console.log('');
    
    // ===== ステップ3: 残高比較 =====
    console.log('⏰ ステップ3: 残高比較分析');
    console.log('----------------------');
    
    const results = [];
    const discrepancies = [];
    
    for (const symbol of symbols) {
      const baseAsset = symbol.split('/')[0];
      
      // 取引所の実残高
      const exchangeBalance = {
        total: balance.total[baseAsset] || 0,
        free: balance.free[baseAsset] || 0,
        used: balance.used[baseAsset] || 0
      };
      
      // 全戦略のサマリーを合計
      let summaryTotal = {
        netPosition: 0,
        buyAmount: 0,
        sellAmount: 0,
        strategies: {}
      };
      
      // 各戦略の詳細を取得（現在の有効戦略 + UNKNOWN戦略）
      const strategiesToCheck = [...activeStrategies, 'UNKNOWN'];
      
      for (const strategyKey of strategiesToCheck) {
        const summary = await getTradeSummary({
          exchangeId: exchangeId,
          symbol: symbol,
          strategyKey: strategyKey
        });
        
        if (summary && summary.netPosition > 0) {
          summaryTotal.netPosition += summary.netPosition;
          summaryTotal.buyAmount += summary.buyAmount;
          summaryTotal.sellAmount += summary.sellAmount;
          
          summaryTotal.strategies[strategyKey] = {
            netPosition: summary.netPosition,
            buyAmount: summary.buyAmount,
            sellAmount: summary.sellAmount
          };
        }
      }
      
      // 比較（有意な残高がある場合のみ）
      if (exchangeBalance.total > 0.0001 || summaryTotal.netPosition > 0.0001) {
        const discrepancy = Math.abs(exchangeBalance.total - summaryTotal.netPosition);
        const discrepancyPercent = exchangeBalance.total > 0 ? 
          (discrepancy / exchangeBalance.total * 100) : 100;
        
        const result = {
          symbol,
          baseAsset,
          exchange: exchangeBalance,
          summary: summaryTotal,
          discrepancy,
          discrepancyPercent
        };
        
        results.push(result);
        
        // 表示
        console.log(`📊 ${symbol}:`);
        console.log(`  取引所残高: ${exchangeBalance.total.toFixed(6)}`);
        console.log(`  Bot管理残高: ${summaryTotal.netPosition.toFixed(6)}`);
        console.log(`  差異: ${discrepancy.toFixed(6)} (${discrepancyPercent.toFixed(2)}%)`);
        
        if (Object.keys(summaryTotal.strategies).length > 0) {
          console.log(`  戦略別詳細:`);
          for (const [strategy, data] of Object.entries(summaryTotal.strategies)) {
            console.log(`    ${strategy}: ${data.netPosition.toFixed(6)}`);
          }
        }
        
        // 大きな差異を記録
        if (discrepancyPercent > 5) {
          discrepancies.push(result);
          console.log(`  ⚠️  大きな差異を検出`);
        } else if (discrepancyPercent < 1) {
          console.log(`  ✅ 整合性OK`);
        } else {
          console.log(`  📝 軽微な差異`);
        }
        
        console.log('');
      }
    }
    
    // ===== 結果サマリー =====
    console.log('================================================================================');
    console.log('📋 結果サマリー');
    console.log('================================================================================');
    console.log(`検査通貨数: ${results.length}`);
    console.log(`大きな差異(>5%): ${discrepancies.length}件`);
    console.log(`処理済み約定: ${totalTradesProcessed}件`);
    console.log('');
    
    if (discrepancies.length > 0) {
      console.log('🚨 主要な差異:');
      discrepancies
        .sort((a, b) => b.discrepancyPercent - a.discrepancyPercent)
        .slice(0, 10)
        .forEach(result => {
          console.log(`  ${result.symbol}: ${result.discrepancyPercent.toFixed(2)}%差異`);
          console.log(`    取引所: ${result.exchange.total.toFixed(6)}`);
          console.log(`    Bot管理: ${result.summary.netPosition.toFixed(6)}`);
          console.log(`    差分: ${result.discrepancy.toFixed(6)}`);
          console.log('');
        });
    } else {
      console.log('✅ すべての通貨で整合性が確認されました');
    }
    
    console.log('================================================================================');
    console.log('🎉 約定確認付き残高チェック完了');
    
    return {
      totalCurrencies: results.length,
      discrepancies: discrepancies.length,
      tradesProcessed: totalTradesProcessed,
      results
    };
    
  } catch (error) {
    console.error('❌ 残高チェックエラー:', error);
    throw error;
  }
}

// スクリプト実行
if (require.main === module) {
  balanceCheckWithTrades().then((result) => {
    console.log(`\\n📊 最終結果: ${result.totalCurrencies}通貨検査, ${result.discrepancies}件の差異, ${result.tradesProcessed}件の約定処理`);
    process.exit(0);
  }).catch((error) => {
    console.error('❌ スクリプト実行失敗:', error);
    process.exit(1);
  });
}

module.exports = { balanceCheckWithTrades };