/**
 * 共通テストランナー - 重複するテストスクリプトパターンを統一
 * similarity-ts分析で95%+の類似度を持つテストスクリプトを統合
 */

class TestRunner {
  constructor(testName, description, phases = []) {
    this.testName = testName;
    this.description = description;
    this.phases = phases;
    this.testResults = {
      summary: { passed: 0, failed: 0, skipped: 0, warnings: 0 }
    };
    this.startTime = Date.now();
  }

  /**
   * ASCII アートバナーを生成
   */
  createBanner(title, subtitle = null) {
    const bannerWidth = 72;
    const padding = '██';
    const border = '█'.repeat(bannerWidth);

    console.log(`
${border}
${padding}${' '.repeat(bannerWidth - 4)}${padding}
${padding}    🧪 ${title.padEnd(bannerWidth - 12)}${padding}
${padding}${' '.repeat(bannerWidth - 4)}${padding}
${border}

## 🎯 ${this.description}
`);

    if (subtitle) {
      console.log(subtitle);
    }

    // フェーズ情報を表示
    if (this.phases.length > 0) {
      this.phases.forEach((phase, index) => {
        console.log(`### Phase ${index + 1}: ${phase.name}`);
        if (phase.description) {
          console.log(phase.description);
        }
      });
      console.log('');
    }
  }

  /**
   * テストフェーズを実行
   */
  async runPhase(phaseNumber, phaseName, testFunction) {
    console.log(`\n🔬 Phase ${phaseNumber}: ${phaseName}`);

    const phaseResults = {};
    this.testResults[`phase${phaseNumber}`] = phaseResults;

    try {
      return await testFunction(phaseResults, this.testResults.summary);
    } catch (error) {
      console.error(`❌ Phase ${phaseNumber} failed:`, error.message);
      phaseResults.error = error.message;
      this.testResults.summary.failed++;
      throw error;
    }
  }

  /**
   * 個別テストを実行
   */
  async runTest(testName, testFunction, phaseResults = null) {
    console.log(`\n📝 ${testName}`);

    try {
      const result = await testFunction();

      if (result === true || (result && result.success)) {
        console.log(`✅ ${testName} - PASS`);
        if (phaseResults) {
          phaseResults[testName] = 'PASS';
        }
        this.testResults.summary.passed++;
        return true;
      } else if (result === false || (result && result.success === false)) {
        console.log(`❌ ${testName} - FAIL`);
        if (phaseResults) {
          phaseResults[testName] = 'FAIL';
        }
        this.testResults.summary.failed++;
        return false;
      } else {
        console.log(`⚠️ ${testName} - SKIP`);
        if (phaseResults) {
          phaseResults[testName] = 'SKIP';
        }
        this.testResults.summary.skipped++;
        return null;
      }
    } catch (error) {
      console.error(`❌ ${testName} - ERROR: ${error.message}`);
      if (phaseResults) {
        phaseResults[testName] = `ERROR: ${error.message}`;
      }
      this.testResults.summary.failed++;
      return false;
    }
  }

  /**
   * 警告を記録
   */
  recordWarning(message, phaseResults = null) {
    console.log(`⚠️ WARNING: ${message}`);
    this.testResults.summary.warnings++;
    if (phaseResults) {
      if (!phaseResults.warnings) {
        phaseResults.warnings = [];
      }
      phaseResults.warnings.push(message);
    }
  }

  /**
   * 統合テストを実行
   */
  async runIntegrationTest(testName, testFunction) {
    console.log(`\n🔄 Integration Test: ${testName}`);

    if (!this.testResults.integration) {
      this.testResults.integration = {};
    }

    try {
      const result = await testFunction();

      if (result === true || (result && result.success)) {
        console.log(`✅ Integration Test: ${testName} - PASS`);
        this.testResults.integration[testName] = 'PASS';
        this.testResults.summary.passed++;
        return true;
      } else {
        console.log(`❌ Integration Test: ${testName} - FAIL`);
        this.testResults.integration[testName] = 'FAIL';
        this.testResults.summary.failed++;
        return false;
      }
    } catch (error) {
      console.error(`❌ Integration Test: ${testName} - ERROR: ${error.message}`);
      this.testResults.integration[testName] = `ERROR: ${error.message}`;
      this.testResults.summary.failed++;
      return false;
    }
  }

  /**
   * 負荷テストを実行
   */
  async runLoadTest(testName, testFunction, iterations = 10) {
    console.log(`\n⚡ Load Test: ${testName} (${iterations} iterations)`);

    if (!this.testResults.loadTest) {
      this.testResults.loadTest = {};
    }

    const startTime = Date.now();
    let passed = 0;
    let failed = 0;

    for (let i = 0; i < iterations; i++) {
      try {
        const result = await testFunction(i + 1);
        if (result === true || (result && result.success)) {
          passed++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`❌ Load test iteration ${i + 1} failed:`, error.message);
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    const successRate = (passed / iterations) * 100;

    console.log(`📊 Load Test Results: ${passed}/${iterations} passed (${successRate.toFixed(1)}%) in ${duration}ms`);

    this.testResults.loadTest[testName] = {
      passed,
      failed,
      successRate,
      duration,
      status: successRate >= 80 ? 'PASS' : 'FAIL'
    };

    if (successRate >= 80) {
      this.testResults.summary.passed++;
      return true;
    } else {
      this.testResults.summary.failed++;
      return false;
    }
  }

  /**
   * 最終サマリーを生成
   */
  generateSummary() {
    const duration = Date.now() - this.startTime;
    const { passed, failed, skipped, warnings } = this.testResults.summary;
    const total = passed + failed + skipped;
    const successRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

    console.log(`\n
████████████████████████████████████████████████████████████████████████
██                                                                    ██
██                      📊 テスト実行サマリー                         ██
██                                                                    ██
████████████████████████████████████████████████████████████████████████

🏁 テスト名: ${this.testName}
⏱️  実行時間: ${duration}ms (${(duration / 1000).toFixed(2)}秒)

📈 結果:
✅ 成功: ${passed}
❌ 失敗: ${failed}
⏭️  スキップ: ${skipped}
⚠️  警告: ${warnings}
📊 成功率: ${successRate}%

${successRate >= 80 ? '🎉 テスト実行成功!' : '⚠️ テストに問題があります'}

詳細結果:
${JSON.stringify(this.testResults, null, 2)}
`);

    return {
      testName: this.testName,
      duration,
      summary: this.testResults.summary,
      successRate: parseFloat(successRate),
      status: successRate >= 80 ? 'SUCCESS' : 'FAILED',
      results: this.testResults
    };
  }

  /**
   * 汎用ヘルパー: システム初期化テスト
   */
  async testSystemInitialization(systemName, initFunction) {
    return await this.runTest(`${systemName} 初期化テスト`, async () => {
      try {
        const result = await initFunction();
        return result ? true : false;
      } catch (error) {
        console.error(`${systemName} 初期化エラー:`, error.message);
        return false;
      }
    });
  }

  /**
   * 汎用ヘルパー: 接続テスト
   */
  async testConnection(connectionName, connectFunction) {
    return await this.runTest(`${connectionName} 接続テスト`, async () => {
      try {
        const result = await connectFunction();
        return result ? true : false;
      } catch (error) {
        console.error(`${connectionName} 接続エラー:`, error.message);
        return false;
      }
    });
  }

  /**
   * 汎用ヘルパー: 機能テスト
   */
  async testFeature(featureName, testFunction, expectedResult = true) {
    return await this.runTest(`${featureName} 機能テスト`, async () => {
      try {
        const result = await testFunction();
        return result === expectedResult;
      } catch (error) {
        console.error(`${featureName} 機能テストエラー:`, error.message);
        return false;
      }
    });
  }
}

module.exports = { TestRunner };