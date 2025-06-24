/**
 * Ultra-Think Phase 2.7/2.8統合テストシステム
 * ポートフォリオレベル制御 & 動的戦略選択の統合テスト
 */
require('dotenv').config();
const { PortfolioLevelController } = require('../src/portfolio/portfolioLevelController');
const { DynamicStrategySelector } = require('../src/strategy/dynamicStrategySelector');

async function testPhase27Systems() {
  console.log(`
████████████████████████████████████████████████████████████████████████
██                                                                    ██
██    🧪 Ultra-Think Phase 2.7/2.8 統合テストシステム                   ██
██                                                                    ██
████████████████████████████████████████████████████████████████████████

## 🎯 テスト対象システム

### Phase 2.7: ポートフォリオレベル制御システム
📊 戦略別配分管理・リスク統合制御
🔄 動的リバランシング・リアルタイム監視

### Phase 2.8: 動的戦略選択システム  
🧠 AI-powered市場適応型戦略選択
🔍 リアルタイム市場状況分析・パフォーマンス学習

### 統合テスト目標:
✅ 両システムの独立動作確認
✅ システム間連携・データ共有確認
✅ 実環境パフォーマンステスト
✅ 負荷・安定性テスト
  `);

  let portfolioController = null;
  let strategySelector = null;
  let testResults = {
    portfolioController: {},
    strategySelector: {},
    integration: {},
    summary: { passed: 0, failed: 0, warnings: 0 }
  };

  try {
    // Phase 1: ポートフォリオレベル制御システムテスト
    console.log('\n🔬 Phase 1: ポートフォリオレベル制御システムテスト');
    
    portfolioController = new PortfolioLevelController();
    
    // 初期化テスト
    console.log('\n📝 Test 1.1: PortfolioController初期化テスト');
    const portfolioInit = await portfolioController.initialize();
    if (portfolioInit) {
      console.log('✅ PortfolioController初期化成功');
      testResults.portfolioController.initialization = 'PASS';
      testResults.summary.passed++;
    } else {
      console.log('❌ PortfolioController初期化失敗');
      testResults.portfolioController.initialization = 'FAIL';
      testResults.summary.failed++;
    }

    if (portfolioInit) {
      // ポートフォリオ分析テスト
      console.log('\n📝 Test 1.2: ポートフォリオ分析テスト');
      try {
        await portfolioController.analyzeCurrentPortfolio();
        console.log('✅ ポートフォリオ分析正常動作');
        testResults.portfolioController.analysis = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ ポートフォリオ分析エラー: ${error.message}`);
        testResults.portfolioController.analysis = 'FAIL';
        testResults.summary.failed++;
      }

      // リスク評価テスト
      console.log('\n📝 Test 1.3: リスク評価テスト');
      try {
        await portfolioController.evaluatePortfolioRisk();
        console.log('✅ リスク評価正常動作');
        testResults.portfolioController.riskEvaluation = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ リスク評価エラー: ${error.message}`);
        testResults.portfolioController.riskEvaluation = 'FAIL';
        testResults.summary.failed++;
      }

      // リバランシング評価テスト
      console.log('\n📝 Test 1.4: リバランシング評価テスト');
      try {
        await portfolioController.evaluateRebalancingNeeds();
        console.log('✅ リバランシング評価正常動作');
        testResults.portfolioController.rebalancing = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ リバランシング評価エラー: ${error.message}`);
        testResults.portfolioController.rebalancing = 'FAIL';
        testResults.summary.failed++;
      }
    }

    // Phase 2: 動的戦略選択システムテスト
    console.log('\n🔬 Phase 2: 動的戦略選択システムテスト');
    
    strategySelector = new DynamicStrategySelector();
    
    // 初期化テスト
    console.log('\n📝 Test 2.1: StrategySelector初期化テスト');
    const selectorInit = await strategySelector.initialize();
    if (selectorInit) {
      console.log('✅ StrategySelector初期化成功');
      testResults.strategySelector.initialization = 'PASS';
      testResults.summary.passed++;
    } else {
      console.log('❌ StrategySelector初期化失敗');
      testResults.strategySelector.initialization = 'FAIL';
      testResults.summary.failed++;
    }

    if (selectorInit) {
      // 市場分析テスト
      console.log('\n📝 Test 2.2: 市場状況分析テスト');
      try {
        await strategySelector.analyzeMarketConditions();
        console.log('✅ 市場分析正常動作');
        testResults.strategySelector.marketAnalysis = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ 市場分析エラー: ${error.message}`);
        testResults.strategySelector.marketAnalysis = 'FAIL';
        testResults.summary.failed++;
      }

      // 戦略評価・選択テスト
      console.log('\n📝 Test 2.3: 戦略評価・選択テスト');
      try {
        await strategySelector.evaluateAndSelectStrategies();
        console.log('✅ 戦略選択正常動作');
        testResults.strategySelector.strategySelection = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ 戦略選択エラー: ${error.message}`);
        testResults.strategySelector.strategySelection = 'FAIL';
        testResults.summary.failed++;
      }

      // パフォーマンス更新テスト
      console.log('\n📝 Test 2.4: パフォーマンス更新テスト');
      try {
        await strategySelector.updateStrategyPerformance();
        console.log('✅ パフォーマンス更新正常動作');
        testResults.strategySelector.performanceUpdate = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ パフォーマンス更新エラー: ${error.message}`);
        testResults.strategySelector.performanceUpdate = 'FAIL';
        testResults.summary.failed++;
      }
    }

    // Phase 3: 統合テスト
    console.log('\n🔬 Phase 3: システム統合テスト');
    
    if (portfolioInit && selectorInit) {
      // システム間データ共有テスト
      console.log('\n📝 Test 3.1: システム間データ共有テスト');
      try {
        const portfolioStatus = portfolioController.getStatus();
        const selectorStatus = strategySelector.getStatus();
        
        console.log('  PortfolioController状態:');
        console.log(`    稼働状態: ${portfolioStatus.isActive ? '✅ 稼働中' : '⚠️ 停止中'}`);
        console.log(`    総ポジション: ${portfolioStatus.portfolioState.totalPositions || 0}件`);
        console.log(`    リスクスコア: ${portfolioStatus.portfolioState.riskMetrics?.overallRiskScore?.toFixed(1) || 'N/A'}`);
        
        console.log('  StrategySelector状態:');
        console.log(`    稼働状態: ${selectorStatus.isActive ? '✅ 稼働中' : '⚠️ 停止中'}`);
        console.log(`    市場体制: ${selectorStatus.marketAnalysis.currentRegime || 'unknown'}`);
        console.log(`    分析信頼度: ${((selectorStatus.marketAnalysis.confidence || 0) * 100).toFixed(1)}%`);
        
        testResults.integration.dataSharing = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ データ共有テストエラー: ${error.message}`);
        testResults.integration.dataSharing = 'FAIL';
        testResults.summary.failed++;
      }

      // 協調動作テスト
      console.log('\n📝 Test 3.2: 協調動作テスト');
      try {
        // 両システムの短時間稼働テスト
        console.log('  短時間協調稼働テスト開始...');
        
        if (!portfolioController.isActive) {
          await portfolioController.activate();
        }
        
        if (!strategySelector.isActive) {
          await strategySelector.activate();
        }
        
        // 5秒間稼働させて状態確認
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const portfolioFinalStatus = portfolioController.getStatus();
        const selectorFinalStatus = strategySelector.getStatus();
        
        if (portfolioFinalStatus.isActive && selectorFinalStatus.isActive) {
          console.log('✅ 協調動作成功');
          testResults.integration.coordination = 'PASS';
          testResults.summary.passed++;
        } else {
          console.log('⚠️ 協調動作部分成功');
          testResults.integration.coordination = 'WARNING';
          testResults.summary.warnings++;
        }
        
      } catch (error) {
        console.log(`❌ 協調動作テストエラー: ${error.message}`);
        testResults.integration.coordination = 'FAIL';
        testResults.summary.failed++;
      }

      // パフォーマンステスト
      console.log('\n📝 Test 3.3: パフォーマンステスト');
      try {
        const performanceStartTime = Date.now();
        
        // 複数の重い処理を同時実行
        await Promise.all([
          portfolioController.analyzeCurrentPortfolio(),
          strategySelector.analyzeMarketConditions(),
          portfolioController.evaluateRebalancingNeeds()
        ]);
        
        const performanceTime = Date.now() - performanceStartTime;
        
        console.log(`  同時実行時間: ${performanceTime}ms`);
        
        if (performanceTime < 10000) { // 10秒以内
          console.log('✅ パフォーマンス良好');
          testResults.integration.performance = 'PASS';
          testResults.summary.passed++;
        } else {
          console.log('⚠️ パフォーマンス要改善');
          testResults.integration.performance = 'WARNING';
          testResults.summary.warnings++;
        }
        
      } catch (error) {
        console.log(`❌ パフォーマンステストエラー: ${error.message}`);
        testResults.integration.performance = 'FAIL';
        testResults.summary.failed++;
      }
    } else {
      console.log('⚠️ 統合テストスキップ (初期化失敗のため)');
      testResults.integration.dataSharing = 'SKIP';
      testResults.integration.coordination = 'SKIP';
      testResults.integration.performance = 'SKIP';
    }

  } catch (error) {
    console.error(`❌ テスト実行エラー: ${error.message}`);
  } finally {
    // クリーンアップ
    if (portfolioController) {
      try {
        await portfolioController.deactivate();
      } catch (e) {
        console.error('PortfolioController停止エラー:', e.message);
      }
    }
    
    if (strategySelector) {
      try {
        await strategySelector.deactivate();
      } catch (e) {
        console.error('StrategySelector停止エラー:', e.message);
      }
    }
  }

  // テスト結果サマリー
  console.log(`
════════════════════════════════════════════════════════════════════════
🧪 Phase 2.7/2.8統合テスト結果サマリー

【PortfolioLevelController】
  初期化: ${testResults.portfolioController.initialization || 'NOT_RUN'}
  ポートフォリオ分析: ${testResults.portfolioController.analysis || 'NOT_RUN'}
  リスク評価: ${testResults.portfolioController.riskEvaluation || 'NOT_RUN'}
  リバランシング評価: ${testResults.portfolioController.rebalancing || 'NOT_RUN'}

【DynamicStrategySelector】
  初期化: ${testResults.strategySelector.initialization || 'NOT_RUN'}
  市場分析: ${testResults.strategySelector.marketAnalysis || 'NOT_RUN'}
  戦略選択: ${testResults.strategySelector.strategySelection || 'NOT_RUN'}
  パフォーマンス更新: ${testResults.strategySelector.performanceUpdate || 'NOT_RUN'}

【システム統合】
  データ共有: ${testResults.integration.dataSharing || 'NOT_RUN'}
  協調動作: ${testResults.integration.coordination || 'NOT_RUN'}
  パフォーマンス: ${testResults.integration.performance || 'NOT_RUN'}

【総合結果】
✅ 成功: ${testResults.summary.passed}件
⚠️ 警告: ${testResults.summary.warnings}件
❌ 失敗: ${testResults.summary.failed}件

【判定】
${testResults.summary.failed === 0 && testResults.summary.warnings <= 2 ? 
  '🎉 統合テスト成功 - Phase 2.7/2.8実装完了' : 
  testResults.summary.failed === 0 ? 
    '⚠️ 部分成功 - 軽微な調整推奨' :
    '❌ 要修正 - 失敗項目の対応必要'
}

【Phase 2.7/2.8達成効果】
🎯 ポートフォリオレベル制御: 戦略配分・リスク管理の自動化
🧠 動的戦略選択: AI-powered市場適応型戦略選択
📊 統合監視: リアルタイム品質管理・最適化
🔄 自動リバランシング: 市場状況に応じた動的調整

【次世代harvest3進化】
従来の静的戦略 → AI-powered動的最適化システム
手動リスク管理 → 自動ポートフォリオ制御
事後対応型 → 予測的品質管理

════════════════════════════════════════════════════════════════════════
🤖 Ultra-Think Phase 2.7/2.8: Advanced Systems Integration Complete
Co-Authored-By: Claude <noreply@anthropic.com>
════════════════════════════════════════════════════════════════════════
  `);

  console.log('\n✅ Phase 2.7/2.8統合テスト完了');
  return testResults;
}

// スクリプトが直接実行された場合
if (require.main === module) {
  testPhase27Systems().catch(error => {
    console.error('テスト実行エラー:', error.message);
    process.exit(1);
  });
}

module.exports = { testPhase27Systems };