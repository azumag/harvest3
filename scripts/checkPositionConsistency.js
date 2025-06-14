#!/usr/bin/env node

/**
 * 銘柄ごとのnetPositionと取引所側のavailable fund（保有量）の整合性チェックスクリプト
 * 
 * 機能:
 * - Redisに記録された各戦略のnetPositionを銘柄ごとに合算
 * - 取引所から実際の保有量（free + used）を取得
 * - 両者を比較して不整合を検出
 * - 詳細な不整合レポートを出力
 */

const { getAllTradeSummaries, initialize } = require('../src/database/redisDatabase');
const { config } = require('../src/config');

/**
 * 取引所の残高情報を取得
 * @param {Object} exchange - 取引所インスタンス
 * @returns {Promise<Object>} 残高情報
 */
async function getExchangeBalances(exchange) {
  try {
    const balance = await exchange.fetchBalance();
    console.log(`✓ ${exchange.id}の残高を取得しました`);
    return balance;
  } catch (error) {
    console.error(`✗ ${exchange.id}の残高取得に失敗:`, error.message);
    return null;
  }
}

/**
 * 銘柄（通貨ペア）からベースアセット（通貨）を抽出
 * @param {string} symbol - 通貨ペア（例: BTC/JPY）
 * @returns {string} ベースアセット（例: BTC）
 */
function extractCurrency(symbol) {
  if (!symbol || typeof symbol !== 'string') return symbol;
  
  // BTC/JPY -> BTC
  const parts = symbol.split('/');
  return parts.length > 0 ? parts[0] : symbol;
}

/**
 * Redis上の戦略別netPositionを銘柄（通貨）ごとに集計
 * @param {Array} summaries - 全ての取引サマリー
 * @returns {Object} 銘柄ごとの集計データ
 */
function aggregateNetPositionsBySymbol(summaries) {
  const symbolAggregates = {};
  
  summaries.forEach(summary => {
    const { exchangeId, symbol, strategyKey, netPosition } = summary;
    const currency = extractCurrency(symbol);
    
    // 取引所ごと、通貨ごとに集計
    if (!symbolAggregates[exchangeId]) {
      symbolAggregates[exchangeId] = {};
    }
    
    if (!symbolAggregates[exchangeId][currency]) {
      symbolAggregates[exchangeId][currency] = {
        totalNetPosition: 0,
        strategies: []
      };
    }
    
    symbolAggregates[exchangeId][currency].totalNetPosition += netPosition;
    symbolAggregates[exchangeId][currency].strategies.push({
      symbol,
      strategyKey,
      netPosition
    });
  });
  
  return symbolAggregates;
}

/**
 * 不整合を検出・分析
 * @param {Object} redisAggregates - Redis集計データ
 * @param {Object} exchangeBalances - 取引所残高データ（取引所ID別）
 * @returns {Object} 整合性チェック結果
 */
function analyzeConsistency(redisAggregates, exchangeBalances) {
  const results = {
    consistent: [],
    inconsistent: [],
    redisOnly: [],
    exchangeOnly: [],
    summary: {
      totalChecked: 0,
      consistentCount: 0,
      inconsistentCount: 0,
      redisOnlyCount: 0,
      exchangeOnlyCount: 0
    }
  };
  
  // 許容誤差（小数点の計算誤差を考慮）
  const TOLERANCE = 0.00000001;
  
  // 各取引所の整合性をチェック
  Object.entries(redisAggregates).forEach(([exchangeId, currencies]) => {
    const exchangeBalance = exchangeBalances[exchangeId];
    
    if (!exchangeBalance) {
      console.warn(`⚠️  取引所 ${exchangeId} の残高データが取得できませんでした`);
      return;
    }
    
    Object.entries(currencies).forEach(([currency, redisData]) => {
      results.summary.totalChecked++;
      
      // 取引所側の保有量（free + used）
      const exchangeFree = exchangeBalance.free[currency] || 0;
      const exchangeUsed = exchangeBalance.used[currency] || 0;
      const exchangeTotal = exchangeFree + exchangeUsed;
      
      // Redis側の集計netPosition
      const redisTotal = redisData.totalNetPosition;
      
      // 差分を計算
      const difference = Math.abs(exchangeTotal - redisTotal);
      const isConsistent = difference <= TOLERANCE;
      
      const comparisonData = {
        exchangeId,
        currency,
        exchangeTotal,
        exchangeFree,
        exchangeUsed,
        redisTotal,
        difference,
        differencePercentage: exchangeTotal > 0 ? (difference / exchangeTotal * 100) : 0,
        strategies: redisData.strategies
      };
      
      if (isConsistent) {
        results.consistent.push(comparisonData);
        results.summary.consistentCount++;
      } else {
        results.inconsistent.push(comparisonData);
        results.summary.inconsistentCount++;
      }
    });
    
    // 取引所にはあるがRedisにない通貨をチェック
    Object.entries(exchangeBalance.total).forEach(([currency, exchangeTotal]) => {
      if (exchangeTotal > TOLERANCE && !currencies[currency]) {
        results.exchangeOnly.push({
          exchangeId,
          currency,
          exchangeTotal,
          exchangeFree: exchangeBalance.free[currency] || 0,
          exchangeUsed: exchangeBalance.used[currency] || 0,
          redisTotal: 0
        });
        results.summary.exchangeOnlyCount++;
      }
    });
  });
  
  // Redisにはあるが取引所にない通貨をチェック
  Object.entries(redisAggregates).forEach(([exchangeId, currencies]) => {
    const exchangeBalance = exchangeBalances[exchangeId];
    if (!exchangeBalance) return;
    
    Object.entries(currencies).forEach(([currency, redisData]) => {
      const exchangeTotal = (exchangeBalance.total[currency] || 0);
      if (redisData.totalNetPosition > TOLERANCE && exchangeTotal <= TOLERANCE) {
        results.redisOnly.push({
          exchangeId,
          currency,
          exchangeTotal: 0,
          redisTotal: redisData.totalNetPosition,
          strategies: redisData.strategies
        });
        results.summary.redisOnlyCount++;
      }
    });
  });
  
  return results;
}

/**
 * 結果をコンソールに出力
 * @param {Object} results - 整合性チェック結果
 */
function printResults(results) {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 ポジション整合性チェック結果');
  console.log('='.repeat(80));
  
  const { summary } = results;
  
  console.log('\n📊 サマリー:');
  console.log(`   総チェック項目数: ${summary.totalChecked}`);
  console.log(`   ✅ 整合性あり: ${summary.consistentCount} (${(summary.consistentCount/summary.totalChecked*100).toFixed(1)}%)`);
  console.log(`   ❌ 不整合: ${summary.inconsistentCount} (${(summary.inconsistentCount/summary.totalChecked*100).toFixed(1)}%)`);
  console.log(`   🔶 Redisのみ: ${summary.redisOnlyCount}`);
  console.log(`   🔷 取引所のみ: ${summary.exchangeOnlyCount}`);
  
  // 不整合の詳細
  if (results.inconsistent.length > 0) {
    console.log('\n❌ 不整合が検出された通貨:');
    console.log('-'.repeat(80));
    
    results.inconsistent
      .sort((a, b) => b.difference - a.difference)
      .forEach(item => {
        console.log(`\n🏦 ${item.exchangeId} - ${item.currency}:`);
        console.log(`   取引所保有量: ${item.exchangeTotal.toFixed(8)} (Free: ${item.exchangeFree.toFixed(8)}, Used: ${item.exchangeUsed.toFixed(8)})`);
        console.log(`   Redis合計: ${item.redisTotal.toFixed(8)}`);
        console.log(`   差分: ${item.difference.toFixed(8)} (${item.differencePercentage.toFixed(2)}%)`);
        
        if (item.strategies && item.strategies.length > 0) {
          console.log('   戦略内訳:');
          item.strategies.forEach(strategy => {
            console.log(`     ${strategy.symbol} [${strategy.strategyKey}]: ${strategy.netPosition.toFixed(8)}`);
          });
        }
      });
  }
  
  // Redisのみに存在（ゾンビポジション）
  if (results.redisOnly.length > 0) {
    console.log('\n🔶 Redisのみに存在（ゾンビポジション）:');
    console.log('-'.repeat(50));
    
    results.redisOnly.forEach(item => {
      console.log(`\n🏦 ${item.exchangeId} - ${item.currency}:`);
      console.log(`   Redis合計: ${item.redisTotal.toFixed(8)}`);
      console.log(`   取引所保有量: 0`);
      
      if (item.strategies && item.strategies.length > 0) {
        console.log('   戦略内訳:');
        item.strategies.forEach(strategy => {
          console.log(`     ${strategy.symbol} [${strategy.strategyKey}]: ${strategy.netPosition.toFixed(8)}`);
        });
      }
    });
  }
  
  // 取引所のみに存在
  if (results.exchangeOnly.length > 0) {
    console.log('\n🔷 取引所のみに存在（Redisに記録なし）:');
    console.log('-'.repeat(50));
    
    results.exchangeOnly.forEach(item => {
      console.log(`\n🏦 ${item.exchangeId} - ${item.currency}:`);
      console.log(`   取引所保有量: ${item.exchangeTotal.toFixed(8)} (Free: ${item.exchangeFree.toFixed(8)}, Used: ${item.exchangeUsed.toFixed(8)})`);
      console.log(`   Redis合計: 0`);
    });
  }
  
  // 整合性のある通貨（簡潔に表示）
  if (results.consistent.length > 0) {
    console.log('\n✅ 整合性のある通貨:');
    console.log('-'.repeat(50));
    
    results.consistent.forEach(item => {
      if (item.exchangeTotal > 0.00000001) { // 微小な値は除外
        console.log(`   ${item.exchangeId} - ${item.currency}: ${item.exchangeTotal.toFixed(8)}`);
      }
    });
  }
  
  console.log('\n' + '='.repeat(80));
}

/**
 * メイン実行関数
 */
async function main() {
  try {
    console.log('🚀 ポジション整合性チェックを開始します...\n');
    
    // 0. Redis接続を初期化
    console.log('🔗 Redis接続を初期化中...');
    await initialize();
    console.log('✓ Redis接続が初期化されました\n');
    
    // 1. Redis上の取引サマリーを取得
    console.log('📊 Redis上の取引サマリーを取得中...');
    const summaries = await getAllTradeSummaries();
    console.log(`✓ ${summaries.length}件の取引サマリーを取得しました\n`);
    
    // 2. 銘柄ごとに集計
    console.log('🔄 銘柄ごとにnetPositionを集計中...');
    const redisAggregates = aggregateNetPositionsBySymbol(summaries);
    console.log('✓ 集計完了\n');
    
    // 3. 各取引所の残高を取得
    console.log('🏦 取引所の残高情報を取得中...');
    const exchangeBalances = {};
    
    for (const [exchangeId, exchangeConfig] of Object.entries(config.exchanges)) {
      if (exchangeConfig.instance) {
        const balance = await getExchangeBalances(exchangeConfig.instance);
        if (balance) {
          exchangeBalances[exchangeId] = balance;
        }
      }
    }
    console.log('\n');
    
    // 4. 整合性チェック
    console.log('🔍 整合性をチェック中...');
    const results = analyzeConsistency(redisAggregates, exchangeBalances);
    
    // 5. 結果出力
    printResults(results);
    
    // 6. 終了ステータス
    if (results.summary.inconsistentCount > 0 || results.summary.redisOnlyCount > 0) {
      console.log('\n⚠️  不整合が検出されました。上記の詳細を確認してください。');
      process.exit(1);
    } else {
      console.log('\n✅ すべてのポジションで整合性が確認されました。');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// スクリプトが直接実行された場合のみmain関数を実行
if (require.main === module) {
  main();
}

module.exports = {
  main,
  aggregateNetPositionsBySymbol,
  analyzeConsistency,
  extractCurrency
};