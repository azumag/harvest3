/**
 * ポジションの買い/売り偏りとリスク管理状況の分析
 */
require('dotenv').config();
const ccxt = require('ccxt');
const redis = require('redis');

async function analyzePositionBias() {
  try {
    console.log('=== ポジション偏りとリスク管理分析 ===');
    console.log(`分析時刻: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

    // Redisクライアント接続
    const client = redis.createClient({ url: 'redis://redis:6379' });
    await client.connect();

    // 1. 現在のポジション分析
    console.log('\n1. 現在のポジション状況');
    const positionKeys = await client.keys('position:*');

    const positions = {
      long: [],
      short: [],
      total: 0,
      totalValue: 0
    };

    for (const key of positionKeys) {
      const positionData = await client.hGetAll(key);
      if (positionData.status === 'open') {
        positions.total++;
        const value = parseFloat(positionData.amount) * parseFloat(positionData.entryPrice);
        positions.totalValue += value;

        const position = {
          symbol: positionData.symbol,
          side: positionData.side,
          amount: parseFloat(positionData.amount),
          entryPrice: parseFloat(positionData.entryPrice),
          value: value,
          strategy: positionData.strategy,
          createdAt: new Date(parseInt(positionData.createdAt))
        };

        if (positionData.side === 'long' || positionData.side === 'buy') {
          positions.long.push(position);
        } else {
          positions.short.push(position);
        }
      }
    }

    console.log(`オープンポジション数: ${positions.total}`);
    console.log(`ロングポジション: ${positions.long.length}件`);
    console.log(`ショートポジション: ${positions.short.length}件`);
    console.log(`総ポジション価値: ¥${positions.totalValue.toLocaleString()}`);

    // 偏り率を計算
    const biasRatio = positions.total > 0 ?
      ((positions.long.length - positions.short.length) / positions.total * 100).toFixed(1) : 0;
    console.log(`\nポジション偏り率: ${biasRatio}% (プラスはロング偏り)`);

    // 2. 戦略別のポジション分析
    console.log('\n2. 戦略別ポジション分析');
    const strategyStats = {};

    [...positions.long, ...positions.short].forEach(pos => {
      if (!strategyStats[pos.strategy]) {
        strategyStats[pos.strategy] = { long: 0, short: 0, value: 0 };
      }
      if (pos.side === 'long' || pos.side === 'buy') {
        strategyStats[pos.strategy].long++;
      } else {
        strategyStats[pos.strategy].short++;
      }
      strategyStats[pos.strategy].value += pos.value;
    });

    Object.entries(strategyStats).forEach(([strategy, stats]) => {
      const total = stats.long + stats.short;
      const bias = total > 0 ? ((stats.long - stats.short) / total * 100).toFixed(1) : 0;
      console.log(`${strategy}: ロング${stats.long}件, ショート${stats.short}件, 偏り${bias}%, 価値¥${stats.value.toLocaleString()}`);
    });

    // 3. 時系列でのポジション取得パターン
    console.log('\n3. 直近24時間のポジション取得パターン');
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const recentPositions = [...positions.long, ...positions.short]
      .filter(pos => pos.createdAt.getTime() > last24h)
      .sort((a, b) => b.createdAt - a.createdAt);

    console.log(`直近24時間の新規ポジション: ${recentPositions.length}件`);
    const recentLong = recentPositions.filter(p => p.side === 'long' || p.side === 'buy').length;
    const recentShort = recentPositions.filter(p => p.side === 'short' || p.side === 'sell').length;
    console.log(`内訳: ロング${recentLong}件, ショート${recentShort}件`);

    // 4. 利用可能残高の確認
    console.log('\n4. 利用可能残高状況');
    const exchange = new ccxt.bitbank({
      apiKey: process.env.BB_API_KEY,
      secret: process.env.BB_API_SECRET
    });

    const balance = await exchange.fetchBalance();
    const jpyBalance = balance.free.JPY || 0;
    const totalBalance = balance.total.JPY || 0;

    console.log(`JPY残高: ¥${totalBalance.toLocaleString()}`);
    console.log(`利用可能JPY: ¥${jpyBalance.toLocaleString()}`);
    console.log(`ポジション使用率: ${(positions.totalValue / totalBalance * 100).toFixed(1)}%`);

    // 5. リスク管理設定の確認
    console.log('\n5. リスク管理設定の確認');
    const config = require('../src/config.js');

    console.log('グローバル設定:');
    console.log(`- maxPositions: ${config.global.maxPositions || '未設定'}`);
    console.log(`- maxPositionValue: ${config.global.maxPositionValue || '未設定'}`);
    console.log(`- maxDrawdown: ${config.global.maxDrawdown || '未設定'}`);
    console.log(`- tradePercentage: ${(config.global.tradePercentage * 100).toFixed(1)}%`);

    if (config.global.dynamicPositionSizing?.enabled) {
      console.log('\n動的ポジションサイジング:');
      console.log(`- baseRiskPerTrade: ${(config.global.dynamicPositionSizing.baseRiskPerTrade * 100).toFixed(1)}%`);
      console.log(`- maxPositionPercent: ${(config.global.dynamicPositionSizing.maxPositionPercent * 100).toFixed(1)}%`);
    }

    // 6. 警告とリスク評価
    console.log('\n6. リスク評価');
    const warnings = [];

    if (Math.abs(biasRatio) > 80) {
      warnings.push(`⚠️ 極端なポジション偏り: ${biasRatio}%`);
    }

    if (positions.totalValue / totalBalance > 0.5) {
      warnings.push(`⚠️ 高いポジション使用率: ${(positions.totalValue / totalBalance * 100).toFixed(1)}%`);
    }

    if (positions.short.length === 0 && positions.long.length > 10) {
      warnings.push('⚠️ ショートポジションが全く存在しない');
    }

    if (jpyBalance < totalBalance * 0.1) {
      warnings.push(`⚠️ 利用可能残高が少ない: ${(jpyBalance / totalBalance * 100).toFixed(1)}%`);
    }

    if (warnings.length > 0) {
      console.log('\n警告:');
      warnings.forEach(w => console.log(w));
    } else {
      console.log('✅ リスクレベル: 正常');
    }

    // 7. 推奨事項
    console.log('\n7. 推奨事項');
    if (Math.abs(biasRatio) > 60) {
      console.log('- ポジションの偏りを是正するため、逆方向のシグナルを重視');
    }
    if (positions.totalValue / totalBalance > 0.3) {
      console.log('- 新規ポジションのサイズを縮小またはエントリーを制限');
    }
    if (positions.short.length === 0) {
      console.log('- ショート戦略の実装または既存戦略の売りシグナル強化');
    }

    await client.quit();
    console.log('\n✅ 分析完了');

  } catch (error) {
    console.error('❌ エラー:', error.message);
  }
}

analyzePositionBias();