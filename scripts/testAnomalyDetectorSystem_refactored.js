/**
 * 基本異常検知システムのテストスクリプト（リファクタリング版）
 * TestRunnerユーティリティを使用して重複コードを削減
 */
require('dotenv').config();
const { BasicAnomalyDetector } = require('../src/monitoring/basicAnomalyDetector');
const { EmergencyRiskLimits } = require('./emergencyRiskLimits');
const { TestRunner } = require('../src/common/testRunner');

async function testAnomalyDetectorSystem() {
  // TestRunnerを初期化（リファクタリング前の重複コードを削減）
  const testRunner = new TestRunner(
    '基本異常検知システム & 緊急リスク制限 統合テスト',
    `
### 1. BasicAnomalyDetector機能テスト
### 2. EmergencyRiskLimits機能テスト  
### 3. 統合動作テスト
### 4. 負荷・耐障害性テスト
### 5. 実環境適用準備チェック`,
    [
      { name: 'BasicAnomalyDetector機能テスト', description: '基本異常検知システムの個別機能テスト' },
      { name: 'EmergencyRiskLimits機能テスト', description: '緊急リスク制限システムのテスト' },
      { name: '統合動作テスト', description: '両システムの連携動作テスト' },
      { name: '負荷・耐障害性テスト', description: 'システムの堅牢性テスト' }
    ]
  );

  // バナー表示（リファクタリング前の手動ASCIIアート作成を削減）
  testRunner.createBanner('基本異常検知システム & 緊急リスク制限 統合テスト');

  let detector = null;
  let riskLimits = null;

  try {
    // Phase 1: BasicAnomalyDetector テスト（リファクタリング前のPhase管理を簡略化）
    await testRunner.runPhase(1, 'BasicAnomalyDetector機能テスト', async (phaseResults) => {
      detector = new BasicAnomalyDetector();
      
      // 初期化テスト（リファクタリング前の手動テスト結果管理を削減）
      await testRunner.testSystemInitialization('BasicAnomalyDetector', async () => {
        return await detector.initialize();
      });

      // 個別機能テスト（リファクタリング前の繰り返しパターンを統一）
      if (detector) {
        await testRunner.testFeature('Position-Summary整合性チェック', async () => {
          await detector.checkPositionSummaryConsistency();
          return true;
        });

        await testRunner.testFeature('ポジション偏りチェック', async () => {
          await detector.checkPositionBias();
          return true;
        });

        await testRunner.testFeature('データ完全性チェック', async () => {
          await detector.checkDataCompleteness();
          return true;
        });

        // 自動修復機能テスト（スキップ処理も統一）
        await testRunner.runTest('自動修復機能テスト', async () => {
          testRunner.recordWarning('自動修復機能テストは本番環境保護のためスキップ');
          return null; // スキップを示すnull
        });
      }
    });

    // Phase 2: EmergencyRiskLimits テスト
    await testRunner.runPhase(2, 'EmergencyRiskLimits機能テスト', async (phaseResults) => {
      riskLimits = new EmergencyRiskLimits();
      
      await testRunner.testSystemInitialization('EmergencyRiskLimits', async () => {
        return await riskLimits.initialize();
      });

      if (riskLimits) {
        await testRunner.testFeature('緊急停止機能', async () => {
          // テスト用の模擬実行
          const canExecute = riskLimits.canExecuteEmergencyStop();
          return canExecute !== undefined;
        });

        await testRunner.testFeature('残高保護機能', async () => {
          const protectionActive = riskLimits.isBalanceProtectionActive();
          return protectionActive !== undefined;
        });

        await testRunner.testFeature('リスク制限設定', async () => {
          const limits = riskLimits.getCurrentLimits();
          return limits && typeof limits === 'object';
        });
      }
    });

    // Phase 3: 統合テスト（リファクタリング前の手動統合テスト管理を簡略化）
    await testRunner.runIntegrationTest('システム間連携テスト', async () => {
      if (!detector || !riskLimits) {
        return false;
      }

      // 異常検知 → 緊急制限発動の流れをテスト
      const anomalyDetected = await detector.runFullCheck();
      if (anomalyDetected && anomalyDetected.length > 0) {
        const emergencyActivated = riskLimits.activateEmergencyMode();
        return emergencyActivated;
      }
      
      return true; // 異常なしも正常
    });

    await testRunner.runIntegrationTest('データ共有テスト', async () => {
      // 両システム間でのデータ共有確認
      const detectorData = detector ? detector.getLastCheckResults() : null;
      const riskLimitsData = riskLimits ? riskLimits.getCurrentStatus() : null;
      
      return detectorData !== null && riskLimitsData !== null;
    });

    // Phase 4: 負荷テスト（リファクタリング前の手動負荷テスト実装を統一）
    await testRunner.runLoadTest('連続異常検知テスト', async (iteration) => {
      if (!detector) return false;
      
      try {
        await detector.runFullCheck();
        return true;
      } catch (error) {
        console.error(`負荷テスト反復 ${iteration} でエラー:`, error.message);
        return false;
      }
    }, 5); // 5回実行

    await testRunner.runLoadTest('緊急制限システム応答テスト', async (iteration) => {
      if (!riskLimits) return false;
      
      try {
        const status = riskLimits.getCurrentStatus();
        return status !== null;
      } catch (error) {
        console.error(`緊急制限応答テスト反復 ${iteration} でエラー:`, error.message);
        return false;
      }
    }, 10); // 10回実行

  } catch (error) {
    console.error('❌ テスト実行中に致命的エラーが発生:', error.message);
    console.error('スタックトレース:', error.stack);
  } finally {
    // システムのクリーンアップ
    try {
      if (detector && typeof detector.cleanup === 'function') {
        await detector.cleanup();
      }
      if (riskLimits && typeof riskLimits.cleanup === 'function') {
        await riskLimits.cleanup();
      }
    } catch (cleanupError) {
      console.error('⚠️ クリーンアップエラー:', cleanupError.message);
    }
  }

  // 最終サマリー生成（リファクタリング前の手動サマリー作成を削減）
  const summary = testRunner.generateSummary();
  
  // 追加の実装推奨事項
  if (summary.successRate < 80) {
    console.log('\n💡 推奨事項:');
    console.log('  - テスト失敗の原因を調査し、システムの安定性を向上させてください');
    console.log('  - 重要なテストが失敗している場合は、本番運用を停止することを検討してください');
  } else if (summary.successRate < 95) {
    console.log('\n💡 推奨事項:');
    console.log('  - 一部のテストで問題が検出されました。継続的な監視を推奨します');
  } else {
    console.log('\n🎉 全てのテストが正常に完了しました！システムは本番運用可能な状態です。');
  }

  return summary;
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  testAnomalyDetectorSystem()
    .then(summary => {
      console.log('\n✅ テストスクリプト実行完了');
      process.exit(summary.status === 'SUCCESS' ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ テストスクリプト実行失敗:', error.message);
      process.exit(1);
    });
}

module.exports = { testAnomalyDetectorSystem };