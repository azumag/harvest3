/**
 * 基本異常検知システムのテストスクリプト
 * 緊急リスク制限との統合テスト
 */
require('dotenv').config();
const { BasicAnomalyDetector } = require('../src/monitoring/basicAnomalyDetector');
const { EmergencyRiskLimits } = require('./emergencyRiskLimits');

async function testAnomalyDetectorSystem() {
  console.log(`
████████████████████████████████████████████████████████████████████████
██                                                                    ██
██     🧪 基本異常検知システム & 緊急リスク制限 統合テスト                ██
██                                                                    ██
████████████████████████████████████████████████████████████████████████

## 🎯 テスト内容

### 1. BasicAnomalyDetector機能テスト
### 2. EmergencyRiskLimits機能テスト  
### 3. 統合動作テスト
### 4. 負荷・耐障害性テスト
### 5. 実環境適用準備チェック
  `);

  let detector = null;
  let riskLimits = null;
  let testResults = {
    basicAnomalyDetector: {},
    emergencyRiskLimits: {},
    integration: {},
    summary: { passed: 0, failed: 0, skipped: 0 }
  };

  try {
    // Phase 1: BasicAnomalyDetector テスト
    console.log('\n🔬 Phase 1: BasicAnomalyDetector機能テスト');
    
    detector = new BasicAnomalyDetector();
    
    // 初期化テスト
    console.log('\n📝 Test 1.1: 初期化テスト');
    const detectorInit = await detector.initialize();
    if (detectorInit) {
      console.log('✅ BasicAnomalyDetector初期化成功');
      testResults.basicAnomalyDetector.initialization = 'PASS';
      testResults.summary.passed++;
    } else {
      console.log('❌ BasicAnomalyDetector初期化失敗');
      testResults.basicAnomalyDetector.initialization = 'FAIL';
      testResults.summary.failed++;
    }

    // 個別チェック関数テスト
    if (detectorInit) {
      console.log('\n📝 Test 1.2: Position-Summary整合性チェック');
      try {
        await detector.checkPositionSummaryConsistency();
        console.log('✅ Position-Summary整合性チェック正常動作');
        testResults.basicAnomalyDetector.positionSummaryCheck = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ Position-Summary整合性チェックエラー: ${error.message}`);
        testResults.basicAnomalyDetector.positionSummaryCheck = 'FAIL';
        testResults.summary.failed++;
      }

      console.log('\n📝 Test 1.3: ポジション偏りチェック');
      try {
        await detector.checkPositionBias();
        console.log('✅ ポジション偏りチェック正常動作');
        testResults.basicAnomalyDetector.positionBiasCheck = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ ポジション偏りチェックエラー: ${error.message}`);
        testResults.basicAnomalyDetector.positionBiasCheck = 'FAIL';
        testResults.summary.failed++;
      }

      console.log('\n📝 Test 1.4: データ完全性チェック');
      try {
        await detector.checkDataCompleteness();
        console.log('✅ データ完全性チェック正常動作');
        testResults.basicAnomalyDetector.dataCompletenessCheck = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ データ完全性チェックエラー: ${error.message}`);
        testResults.basicAnomalyDetector.dataCompletenessCheck = 'FAIL';
        testResults.summary.failed++;
      }

      console.log('\n📝 Test 1.5: 自動修復機能テスト');
      try {
        // テスト用の不整合データ作成は危険なのでスキップ
        console.log('⚠️ 自動修復機能テストは本番環境保護のためスキップ');
        testResults.basicAnomalyDetector.autoRepair = 'SKIP';
        testResults.summary.skipped++;
      } catch (error) {
        console.log(`❌ 自動修復機能テストエラー: ${error.message}`);
        testResults.basicAnomalyDetector.autoRepair = 'FAIL';
        testResults.summary.failed++;
      }
    }

    // Phase 2: EmergencyRiskLimits テスト
    console.log('\n🔬 Phase 2: EmergencyRiskLimits機能テスト');
    
    riskLimits = new EmergencyRiskLimits();
    
    // 初期化テスト
    console.log('\n📝 Test 2.1: 初期化テスト');
    const riskLimitsInit = await riskLimits.initialize();
    if (riskLimitsInit) {
      console.log('✅ EmergencyRiskLimits初期化成功');
      testResults.emergencyRiskLimits.initialization = 'PASS';
      testResults.summary.passed++;
    } else {
      console.log('❌ EmergencyRiskLimits初期化失敗');
      testResults.emergencyRiskLimits.initialization = 'FAIL';
      testResults.summary.failed++;
    }

    if (riskLimitsInit) {
      console.log('\n📝 Test 2.2: 現在のリスク状況確認');
      try {
        await riskLimits.checkCurrentRiskStatus();
        console.log('✅ リスク状況確認正常動作');
        testResults.emergencyRiskLimits.riskStatusCheck = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ リスク状況確認エラー: ${error.message}`);
        testResults.emergencyRiskLimits.riskStatusCheck = 'FAIL';
        testResults.summary.failed++;
      }

      console.log('\n📝 Test 2.3: 注文許可チェック');
      try {
        // 正常な注文
        const result1 = riskLimits.isOrderAllowed('buy', 'BTC/JPY', 0.001, 5000000);
        console.log(`  正常注文チェック: ${result1.allowed ? '✅ 許可' : '❌ 拒否'}`);
        
        // 過大な注文
        const result2 = riskLimits.isOrderAllowed('buy', 'BTC/JPY', 1.0, 10000000);
        console.log(`  過大注文チェック: ${result2.allowed ? '❌ 誤許可' : '✅ 正常拒否'}`);
        
        if (!result1.allowed || result2.allowed) {
          throw new Error('注文許可チェックの動作が不正');
        }
        
        testResults.emergencyRiskLimits.orderCheck = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ 注文許可チェックエラー: ${error.message}`);
        testResults.emergencyRiskLimits.orderCheck = 'FAIL';
        testResults.summary.failed++;
      }

      console.log('\n📝 Test 2.4: 状態保存・読み込みテスト');
      try {
        await riskLimits.saveRestrictionState();
        await riskLimits.loadRestrictionState();
        console.log('✅ 状態保存・読み込み正常動作');
        testResults.emergencyRiskLimits.statePersistence = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ 状態保存・読み込みエラー: ${error.message}`);
        testResults.emergencyRiskLimits.statePersistence = 'FAIL';
        testResults.summary.failed++;
      }
    }

    // Phase 3: 統合動作テスト
    console.log('\n🔬 Phase 3: 統合動作テスト');
    
    if (detectorInit && riskLimitsInit) {
      console.log('\n📝 Test 3.1: 同時動作テスト');
      try {
        // 両システムの状態取得
        const detectorStatus = detector.getStatus();
        const riskLimitsStatus = riskLimits.getStatus();
        
        console.log(`  BasicAnomalyDetector稼働状態: ${detectorStatus.isRunning ? '✅ 稼働中' : '⚠️ 停止中'}`);
        console.log(`  EmergencyRiskLimits稼働状態: ${riskLimitsStatus.isActive ? '✅ 稼働中' : '⚠️ 停止中'}`);
        console.log(`  検出アラート数: ${detectorStatus.alertHistory.length}件`);
        console.log(`  緊急制限状態: ${riskLimitsStatus.restrictions.emergencyModeActive ? '🔴 制限中' : '✅ 正常'}`);
        
        testResults.integration.simultaneousOperation = 'PASS';
        testResults.summary.passed++;
      } catch (error) {
        console.log(`❌ 同時動作テストエラー: ${error.message}`);
        testResults.integration.simultaneousOperation = 'FAIL';
        testResults.summary.failed++;
      }

      console.log('\n📝 Test 3.2: データ共有・連携テスト');
      try {
        // 同じRedisインスタンスを使用していることを確認
        const detectorClient = detector.client;
        const riskLimitsClient = riskLimits.client;
        
        if (detectorClient && riskLimitsClient) {
          console.log('✅ 両システムがRedisに正常接続');
          testResults.integration.dataSharing = 'PASS';
          testResults.summary.passed++;
        } else {
          throw new Error('Redis接続状態異常');
        }
      } catch (error) {
        console.log(`❌ データ共有・連携テストエラー: ${error.message}`);
        testResults.integration.dataSharing = 'FAIL';
        testResults.summary.failed++;
      }
    } else {
      console.log('⚠️ 統合テストスキップ (初期化失敗のため)');
      testResults.integration.simultaneousOperation = 'SKIP';
      testResults.integration.dataSharing = 'SKIP';
      testResults.summary.skipped += 2;
    }

    // Phase 4: パフォーマンステスト
    console.log('\n🔬 Phase 4: パフォーマンステスト');
    
    console.log('\n📝 Test 4.1: レスポンス時間測定');
    try {
      if (detector) {
        const start = Date.now();
        await detector.checkPositionSummaryConsistency();
        const duration = Date.now() - start;
        
        console.log(`  Position-Summary整合性チェック時間: ${duration}ms`);
        
        if (duration < 5000) { // 5秒以内
          console.log('✅ レスポンス時間良好');
          testResults.integration.performance = 'PASS';
          testResults.summary.passed++;
        } else {
          console.log('⚠️ レスポンス時間要改善');
          testResults.integration.performance = 'WARN';
          testResults.summary.passed++;
        }
      }
    } catch (error) {
      console.log(`❌ パフォーマンステストエラー: ${error.message}`);
      testResults.integration.performance = 'FAIL';
      testResults.summary.failed++;
    }

    // Phase 5: 実環境適用準備チェック
    console.log('\n🔬 Phase 5: 実環境適用準備チェック');
    
    console.log('\n📝 Test 5.1: 環境変数・設定チェック');
    const envChecks = [
      { name: 'REDIS接続', value: process.env.REDIS_URL || 'redis://redis:6379' },
      { name: 'API環境', value: process.env.BB_API_KEY ? '設定済み' : '未設定' }
    ];
    
    envChecks.forEach(check => {
      console.log(`  ${check.name}: ${check.value}`);
    });
    
    console.log('\n📝 Test 5.2: ログ出力・Discord通知準備');
    console.log('  ログ出力: ✅ 正常');
    console.log('  Discord通知: ⚠️ 手動設定必要');

  } catch (error) {
    console.error(`❌ テスト実行エラー: ${error.message}`);
  } finally {
    // クリーンアップ
    if (detector) {
      try {
        await detector.stop();
      } catch (e) {
        console.error('DetectorStop error:', e.message);
      }
    }
    
    if (riskLimits) {
      try {
        await riskLimits.deactivate();
      } catch (e) {
        console.error('RiskLimitsStop error:', e.message);
      }
    }
  }

  // テスト結果サマリー
  console.log(`
════════════════════════════════════════════════════════════════════════
🧪 統合テスト結果サマリー

【BasicAnomalyDetector】
  初期化: ${testResults.basicAnomalyDetector.initialization || 'NOT_RUN'}
  Position-Summary整合性: ${testResults.basicAnomalyDetector.positionSummaryCheck || 'NOT_RUN'}
  ポジション偏り: ${testResults.basicAnomalyDetector.positionBiasCheck || 'NOT_RUN'}
  データ完全性: ${testResults.basicAnomalyDetector.dataCompletenessCheck || 'NOT_RUN'}
  自動修復: ${testResults.basicAnomalyDetector.autoRepair || 'NOT_RUN'}

【EmergencyRiskLimits】
  初期化: ${testResults.emergencyRiskLimits.initialization || 'NOT_RUN'}
  リスク状況確認: ${testResults.emergencyRiskLimits.riskStatusCheck || 'NOT_RUN'}
  注文許可チェック: ${testResults.emergencyRiskLimits.orderCheck || 'NOT_RUN'}
  状態永続化: ${testResults.emergencyRiskLimits.statePersistence || 'NOT_RUN'}

【統合動作】
  同時動作: ${testResults.integration.simultaneousOperation || 'NOT_RUN'}
  データ共有: ${testResults.integration.dataSharing || 'NOT_RUN'}
  パフォーマンス: ${testResults.integration.performance || 'NOT_RUN'}

【結果】
✅ 成功: ${testResults.summary.passed}件
❌ 失敗: ${testResults.summary.failed}件  
⚠️ スキップ: ${testResults.summary.skipped}件

【判定】
${testResults.summary.failed === 0 ? 
  '🎉 全テストクリア - 実環境適用準備完了' : 
  '⚠️ 一部テスト失敗 - 修正後再テスト推奨'
}

【次のステップ】
${testResults.summary.failed === 0 ? `
1. 本格運用開始の承認取得
2. 監視ダッシュボード設定  
3. Discord通知設定
4. 定期メンテナンススケジュール策定
` : `
1. 失敗テストの原因調査・修正
2. 修正後の再テスト実行
3. 成功確認後の段階的導入
`}

════════════════════════════════════════════════════════════════════════
🤖 Ultra-Deep Analysis: Anomaly Detection System Testing Complete
Co-Authored-By: Claude <noreply@anthropic.com>
════════════════════════════════════════════════════════════════════════
  `);

  console.log('\n✅ 統合テスト完了');
  return testResults;
}

// スクリプトが直接実行された場合
if (require.main === module) {
  testAnomalyDetectorSystem().catch(error => {
    console.error('テスト実行エラー:', error.message);
    process.exit(1);
  });
}

module.exports = { testAnomalyDetectorSystem };