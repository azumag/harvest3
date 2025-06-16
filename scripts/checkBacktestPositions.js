/**
 * バックテスト後のポジション整合性チェックスクリプト
 * 強制決済後にポジションデータが適切にクリーンアップされているかを確認
 */

const { initializeDB, getMarketParametersByExchangeSymbol, getSymbolsByExchange } = require('../src/database/manager');
const { config } = require('../src/config');
const { getStrategyPositionsRedis, getTradeSummary } = require('../src/database/redisDatabase');
const { postResultToDiscord } = require('../src/common/notifications');
const { errorHandler } = require('../src/common/errorHandler');

async function checkBacktestPositions() {
  console.log('=== バックテスト後のポジション整合性チェック開始 ===');
  
  try {
    // データベース初期化
    await initializeDB();
    
    // 全取引所・通貨ペア・戦略の組み合わせを取得
    const symbolsByExchange = await getSymbolsByExchange(config);
    const allInconsistencies = [];
    let totalPositions = 0;
    let openPositions = 0;
    let closedPositions = 0;
    let disabledStrategies = [];
    
    for (const exchangeId of Object.keys(symbolsByExchange)) {
      const exchange = config.exchanges[exchangeId]?.instance;
      if (!exchange) continue;
      
      console.log(`\n--- 取引所: ${exchangeId} ---`);
      
      for (const symbol of symbolsByExchange[exchangeId]) {
        console.log(`  通貨ペア: ${symbol}`);
        
        for (const strategyKey of Object.keys(config.strategies)) {
          const strategy = config.strategies[strategyKey];
          
          try {
            // 戦略の有効/無効状態をチェック
            const isStrategyEnabled = strategy.enabled;
            
            // 戦略のポジションデータを取得
            const positions = await getStrategyPositionsRedis(exchangeId, symbol, strategyKey);
            
            if (positions.length > 0) {
              totalPositions += positions.length;
              
              // ポジションの状態別カウント
              const openCount = positions.filter(p => p.status === 'open').length;
              const closedCount = positions.filter(p => p.status === 'closed').length;
              
              openPositions += openCount;
              closedPositions += closedCount;
              
              console.log(`    戦略 ${strategyKey}: ${positions.length}件 (Open: ${openCount}, Closed: ${closedCount}, Enabled: ${isStrategyEnabled})`);
              
              // 無効な戦略にオープンポジションがある場合の検出
              if (!isStrategyEnabled && openCount > 0) {
                allInconsistencies.push({
                  type: 'disabled_strategy_with_open_positions',
                  exchangeId,
                  symbol,
                  strategyKey,
                  openPositions: openCount,
                  positions: positions.filter(p => p.status === 'open').map(p => ({
                    key: p.key,
                    amount: p.amount,
                    price: p.price,
                    createdAt: new Date(p.createdAt).toLocaleString('ja-JP')
                  }))
                });
                
                console.log(`      ⚠️  無効な戦略にオープンポジション: ${openCount}件`);
              }
              
              // 長期間オープンのポジションをチェック（24時間以上）
              const now = Date.now();
              const oneDayAgo = now - (24 * 60 * 60 * 1000);
              const twoDaysAgo = now - (48 * 60 * 60 * 1000);
              
              for (const position of positions) {
                if (position.status === 'open') {
                  const ageHours = Math.floor((now - position.createdAt) / (60 * 60 * 1000));
                  
                  // 24時間以上のオープンポジション
                  if (position.createdAt < oneDayAgo) {
                    const severity = position.createdAt < twoDaysAgo ? 'critical' : 'warning';
                    
                    allInconsistencies.push({
                      type: 'long_open_position',
                      severity,
                      exchangeId,
                      symbol,
                      strategyKey,
                      positionKey: position.key,
                      ageHours,
                      createdAt: new Date(position.createdAt).toLocaleString('ja-JP'),
                      amount: position.amount,
                      price: position.price,
                      strategyEnabled: isStrategyEnabled
                    });
                    
                    const alertLevel = severity === 'critical' ? '🚨' : '⚠️';
                    console.log(`      ${alertLevel} 長期オープンポジション: ${position.key} (${ageHours}時間前)`);
                  }
                }
              }
            }
            
            // 無効化された戦略を記録
            if (!isStrategyEnabled) {
              disabledStrategies.push({ exchangeId, symbol, strategyKey, positionCount: positions.length });
            }
            
          } catch (error) {
            await errorHandler.handleError(error, `ポジション取得: ${exchangeId}/${symbol}/${strategyKey}`, false);
            
            allInconsistencies.push({
              type: 'position_fetch_error',
              exchangeId,
              symbol,
              strategyKey,
              error: error.message
            });
          }
        }
      }
    }
    
    // 結果のサマリー
    console.log('\n=== ポジション整合性チェック結果 ===');
    console.log(`総ポジション数: ${totalPositions}`);
    console.log(`オープンポジション: ${openPositions}`);
    console.log(`クローズポジション: ${closedPositions}`);
    console.log(`無効化された戦略: ${disabledStrategies.length}`);
    console.log(`発見された問題: ${allInconsistencies.length}件`);
    
    // 問題の分類
    const criticalIssues = allInconsistencies.filter(i => 
      i.type === 'disabled_strategy_with_open_positions' || 
      (i.type === 'long_open_position' && i.severity === 'critical')
    );
    const warningIssues = allInconsistencies.filter(i => 
      i.type === 'long_open_position' && i.severity === 'warning'
    );
    const errorIssues = allInconsistencies.filter(i => i.type === 'position_fetch_error');
    
    // Discord通知
    let discordMessage = `🔍 **バックテスト後ポジション整合性チェック**\n\n`;
    discordMessage += `📊 **統計**\n`;
    discordMessage += `・総ポジション数: ${totalPositions}\n`;
    discordMessage += `・オープンポジション: ${openPositions}\n`;
    discordMessage += `・クローズポジション: ${closedPositions}\n`;
    discordMessage += `・無効化された戦略: ${disabledStrategies.length}\n`;
    discordMessage += `・発見された問題: ${allInconsistencies.length}件\n\n`;
    
    if (criticalIssues.length > 0) {
      discordMessage += `🚨 **緊急対応が必要な問題**: ${criticalIssues.length}件\n`;
      
      const disabledWithPositions = criticalIssues.filter(i => i.type === 'disabled_strategy_with_open_positions');
      const criticalLongPositions = criticalIssues.filter(i => i.type === 'long_open_position');
      
      if (disabledWithPositions.length > 0) {
        discordMessage += `❌ **無効戦略のオープンポジション**: ${disabledWithPositions.length}件\n`;
        for (const issue of disabledWithPositions.slice(0, 3)) {
          discordMessage += `　・${issue.exchangeId}/${issue.symbol}/${issue.strategyKey}: ${issue.openPositions}件\n`;
        }
        if (disabledWithPositions.length > 3) {
          discordMessage += `　・他${disabledWithPositions.length - 3}件...\n`;
        }
      }
      
      if (criticalLongPositions.length > 0) {
        discordMessage += `🕒 **緊急: 48時間以上のオープンポジション**: ${criticalLongPositions.length}件\n`;
        for (const pos of criticalLongPositions.slice(0, 3)) {
          discordMessage += `　・${pos.exchangeId}/${pos.symbol}/${pos.strategyKey}: ${pos.ageHours}時間\n`;
        }
        if (criticalLongPositions.length > 3) {
          discordMessage += `　・他${criticalLongPositions.length - 3}件...\n`;
        }
      }
      discordMessage += `\n`;
    }
    
    if (warningIssues.length > 0) {
      discordMessage += `⚠️ **注意が必要な問題**: ${warningIssues.length}件\n`;
      discordMessage += `🕒 **24-48時間のオープンポジション**: ${warningIssues.length}件\n`;
      for (const pos of warningIssues.slice(0, 3)) {
        discordMessage += `　・${pos.exchangeId}/${pos.symbol}/${pos.strategyKey}: ${pos.ageHours}時間\n`;
      }
      if (warningIssues.length > 3) {
        discordMessage += `　・他${warningIssues.length - 3}件...\n`;
      }
      discordMessage += `\n`;
    }
    
    if (errorIssues.length > 0) {
      discordMessage += `❌ **システムエラー**: ${errorIssues.length}件\n`;
      for (const error of errorIssues.slice(0, 3)) {
        discordMessage += `　・${error.exchangeId}/${error.symbol}/${error.strategyKey}\n`;
      }
      if (errorIssues.length > 3) {
        discordMessage += `　・他${errorIssues.length - 3}件...\n`;
      }
      discordMessage += `\n`;
    }
    
    if (allInconsistencies.length === 0) {
      discordMessage += `✅ **問題なし**\n`;
      discordMessage += `全ポジションが適切に管理されています。\n`;
      discordMessage += `バックテストの強制決済処理が正常に機能しています。`;
    } else {
      discordMessage += `🔧 **推奨アクション**\n`;
      if (criticalIssues.length > 0) {
        discordMessage += `・🚨 緊急: 無効戦略のオープンポジションを手動クローズ\n`;
        discordMessage += `・🚨 緊急: 長期オープンポジションの確認と処理\n`;
      }
      if (warningIssues.length > 0) {
        discordMessage += `・⚠️ 24時間以上のポジションを監視・確認\n`;
      }
      if (errorIssues.length > 0) {
        discordMessage += `・❌ システムエラーの詳細調査\n`;
      }
      discordMessage += `・🔧 必要に応じて closeAllPositions.js の実行を検討`;
    }
    
    discordMessage += `\n\n📅 チェック実行時刻: ${new Date().toLocaleString('ja-JP')}`;
    
    await postResultToDiscord(discordMessage);
    
    // 詳細ログの出力
    if (allInconsistencies.length > 0) {
      console.log('\n=== 詳細な問題リスト ===');
      for (const inconsistency of allInconsistencies) {
        console.log(JSON.stringify(inconsistency, null, 2));
      }
    }
    
    // 無効化された戦略の一覧
    if (disabledStrategies.length > 0) {
      console.log('\n=== 無効化された戦略一覧 ===');
      for (const strategy of disabledStrategies) {
        console.log(`${strategy.exchangeId}/${strategy.symbol}/${strategy.strategyKey} (ポジション数: ${strategy.positionCount})`);
      }
    }
    
    console.log('\n=== バックテスト後ポジション整合性チェック完了 ===');
    
    // 異常の重要度に応じて終了コードを返す
    if (criticalIssues.length > 0) {
      process.exit(2); // 緊急対応が必要
    } else if (allInconsistencies.length > 0) {
      process.exit(1); // 注意が必要
    } else {
      process.exit(0); // 正常
    }
    
  } catch (error) {
    await errorHandler.handleError(error, 'バックテストポジション整合性チェック', false);
    await postResultToDiscord(`❌ **バックテストポジション整合性チェックエラー**\n\nエラー: ${error.message}\n\n📅 ${new Date().toLocaleString('ja-JP')}`);
    process.exit(3);
  }
}

// スクリプトが直接実行された場合
if (require.main === module) {
  checkBacktestPositions();
}

module.exports = { checkBacktestPositions };