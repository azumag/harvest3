/**
 * 自動メンテナンススケジューラー
 * レビュー結果に基づき、手動スクリプトの自動化とモニタリング強化を実装
 */

const { spawn } = require('child_process');
const path = require('path');
const { getSchedulingManager } = require('./schedulingManager');
const { postOrderToDiscord, postErrorToDiscord } = require('./notifications');

class MaintenanceScheduler {
  constructor() {
    this.schedulingManager = getSchedulingManager();
    this.isInitialized = false;
    this.lastResults = new Map();
  }

  /**
   * スクリプトを安全に実行し、結果をログ出力・通知
   * @param {string} scriptPath - 実行するスクリプトのパス
   * @param {string} scriptName - スクリプト名（ログ用）
   * @param {Array} args - 引数配列
   * @param {Object} options - 実行オプション
   * @returns {Object} 実行結果
   */
  async executeMaintenanceScript(scriptPath, scriptName, args = [], options = {}) {
    const { timeout = 300000, notifyOnError = true, notifyOnSuccess = false } = options;
    
    return new Promise((resolve) => {
      const startTime = Date.now();
      console.log(`[メンテナンス] ${scriptName} 実行開始...`);
      
      const scriptProcess = spawn('node', [scriptPath, ...args], {
        cwd: path.join(__dirname, '../..'),
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeout
      });
      
      let stdout = '';
      let stderr = '';
      
      scriptProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`[${scriptName}] ${data.toString().trim()}`);
      });
      
      scriptProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`[${scriptName}] ERROR: ${data.toString().trim()}`);
      });
      
      scriptProcess.on('close', async (code) => {
        const duration = Date.now() - startTime;
        const result = {
          success: code === 0,
          code,
          stdout,
          stderr,
          duration,
          scriptName,
          timestamp: new Date().toISOString()
        };
        
        this.lastResults.set(scriptName, result);
        
        if (result.success) {
          console.log(`[メンテナンス] ${scriptName} 正常完了 (${duration}ms)`);
          
          if (notifyOnSuccess) {
            const message = `✅ **${scriptName}実行完了**\n` +
                           `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                           `⏱️ 処理時間: ${duration}ms\n` +
                           `📊 終了コード: ${code}\n` +
                           `⏰ ${new Date().toLocaleString('ja-JP')}`;
            await postOrderToDiscord(message);
          }
        } else {
          console.error(`[メンテナンス] ${scriptName} エラー終了 (code: ${code}, ${duration}ms)`);
          
          if (notifyOnError) {
            const message = `❌ **${scriptName}実行エラー**\n` +
                           `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                           `🚨 終了コード: ${code}\n` +
                           `⏱️ 処理時間: ${duration}ms\n` +
                           `📋 **エラー出力**:\n\`\`\`\n${stderr.slice(-500)}\`\`\`\n` +
                           `⏰ ${new Date().toLocaleString('ja-JP')}`;
            await postErrorToDiscord(message);
          }
        }
        
        resolve(result);
      });
      
      scriptProcess.on('error', async (error) => {
        const duration = Date.now() - startTime;
        console.error(`[メンテナンス] ${scriptName} プロセスエラー:`, error);
        
        const result = {
          success: false,
          code: -1,
          stdout,
          stderr: error.message,
          duration,
          scriptName,
          timestamp: new Date().toISOString(),
          error: error.message
        };
        
        this.lastResults.set(scriptName, result);
        
        if (notifyOnError) {
          const message = `💥 **${scriptName}プロセスエラー**\n` +
                         `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                         `🚨 エラー: ${error.message}\n` +
                         `⏱️ 処理時間: ${duration}ms\n` +
                         `⏰ ${new Date().toLocaleString('ja-JP')}`;
          await postErrorToDiscord(message);
        }
        
        resolve(result);
      });
      
      // タイムアウト処理
      setTimeout(() => {
        if (!scriptProcess.killed) {
          console.warn(`[メンテナンス] ${scriptName} タイムアウト、プロセスを終了します`);
          scriptProcess.kill('SIGTERM');
        }
      }, timeout);
    });
  }

  /**
   * ポジション整合性チェックの自動実行
   */
  async runPositionConsistencyCheck() {
    const result = await this.executeMaintenanceScript(
      'scripts/checkPositionConsistency.js',
      'ポジション整合性チェック',
      [],
      { 
        timeout: 120000, // 2分
        notifyOnError: true,
        notifyOnSuccess: false
      }
    );
    
    // 成功時でも重要な結果があれば通知
    if (result.success && result.stdout) {
      const output = result.stdout;
      
      // 不整合検出の確認
      if (output.includes('不整合') || output.includes('修正') || output.includes('削除')) {
        const summary = this.extractSummaryFromOutput(output);
        const message = `⚠️ **ポジション整合性チェック結果**\n` +
                       `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                       `${summary}\n` +
                       `⏰ ${new Date().toLocaleString('ja-JP')}`;
        await postOrderToDiscord(message);
      }
    }
    
    return result;
  }

  /**
   * ポジション不整合の自動修正
   */
  async runPositionInconsistencyFix() {
    const result = await this.executeMaintenanceScript(
      'scripts/fixPositionInconsistencies.js',
      'ポジション不整合自動修正',
      ['--auto-fix'], // 自動修正モード
      { 
        timeout: 180000, // 3分
        notifyOnError: true,
        notifyOnSuccess: true
      }
    );
    
    return result;
  }

  /**
   * 残高整合性チェック
   */
  async runBalanceConsistencyCheck() {
    const result = await this.executeMaintenanceScript(
      'scripts/balanceConsistencyChecker.js',
      '残高整合性チェック',
      [],
      { 
        timeout: 90000, // 1.5分
        notifyOnError: true,
        notifyOnSuccess: false
      }
    );
    
    return result;
  }

  /**
   * 取引所残高との比較チェック
   */
  async runExchangeBalanceComparison() {
    const result = await this.executeMaintenanceScript(
      'scripts/compareExchangeVsSummary.js',
      '取引所残高比較',
      [],
      { 
        timeout: 120000, // 2分
        notifyOnError: true,
        notifyOnSuccess: false
      }
    );
    
    return result;
  }

  /**
   * ゴーストポジション削除
   */
  async runGhostPositionCleanup() {
    const result = await this.executeMaintenanceScript(
      'scripts/deleteGhostPositions.js',
      'ゴーストポジション削除',
      [],
      { 
        timeout: 60000, // 1分
        notifyOnError: true,
        notifyOnSuccess: true
      }
    );
    
    return result;
  }

  /**
   * 出力から要約を抽出
   * @param {string} output - スクリプトの出力
   * @returns {string} 要約テキスト
   */
  extractSummaryFromOutput(output) {
    const lines = output.split('\n');
    const summaryLines = [];
    
    for (const line of lines) {
      if (line.includes('不整合') || 
          line.includes('修正') || 
          line.includes('削除') ||
          line.includes('ASTR') ||
          line.includes('GALA') ||
          line.includes('総計') ||
          line.includes('件数')) {
        summaryLines.push(line.trim());
      }
    }
    
    return summaryLines.slice(-10).join('\n') || 'エラー: 要約を抽出できませんでした';
  }

  /**
   * 包括的な週次メンテナンス
   */
  async runWeeklyMaintenance() {
    console.log('[メンテナンス] 週次包括メンテナンス開始...');
    
    const tasks = [
      { name: 'ポジション整合性チェック', func: () => this.runPositionConsistencyCheck() },
      { name: 'ポジション不整合修正', func: () => this.runPositionInconsistencyFix() },
      { name: '残高整合性チェック', func: () => this.runBalanceConsistencyCheck() },
      { name: '取引所残高比較', func: () => this.runExchangeBalanceComparison() },
      { name: 'ゴーストポジション削除', func: () => this.runGhostPositionCleanup() }
    ];
    
    const results = [];
    
    for (const task of tasks) {
      try {
        console.log(`[週次メンテナンス] ${task.name}実行中...`);
        const result = await task.func();
        results.push(result);
        
        // タスク間の待機時間（30秒）
        await new Promise(resolve => setTimeout(resolve, 30000));
      } catch (error) {
        console.error(`[週次メンテナンス] ${task.name}エラー:`, error);
        results.push({
          success: false,
          error: error.message,
          scriptName: task.name
        });
      }
    }
    
    // 週次メンテナンス結果のサマリー通知
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.length - successCount;
    
    let message = `📊 **週次メンテナンス完了**\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `✅ 成功: ${successCount}件\n` +
                  `❌ エラー: ${errorCount}件\n\n` +
                  `📋 **実行結果**:\n`;
    
    results.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      const duration = result.duration ? `(${result.duration}ms)` : '';
      message += `${status} ${tasks[index].name} ${duration}\n`;
    });
    
    message += `\n⏰ ${new Date().toLocaleString('ja-JP')}`;
    
    await postOrderToDiscord(message);
    
    return results;
  }

  /**
   * スケジュールの初期化と登録
   */
  initializeSchedules() {
    if (this.isInitialized) {
      console.log('[メンテナンス] スケジュールは既に初期化済みです');
      return;
    }
    
    console.log('[メンテナンス] 自動メンテナンススケジュールを初期化中...');
    
    // 1. ポジション整合性チェック（2時間間隔）
    this.schedulingManager.scheduleIntervalTask(
      'position-consistency-check',
      () => this.runPositionConsistencyCheck(),
      120, // 2時間 = 120分
      { description: 'ポジション整合性チェック（2時間間隔）' }
    );
    
    // 2. 残高整合性チェック（1時間間隔）
    this.schedulingManager.scheduleIntervalTask(
      'balance-consistency-check',
      () => this.runBalanceConsistencyCheck(),
      60, // 1時間 = 60分
      { description: '残高整合性チェック（1時間間隔）' }
    );
    
    // 3. 取引所残高比較（3時間間隔）
    this.schedulingManager.scheduleIntervalTask(
      'exchange-balance-comparison',
      () => this.runExchangeBalanceComparison(),
      180, // 3時間 = 180分
      { description: '取引所残高比較（3時間間隔）' }
    );
    
    // 4. ゴーストポジション削除（6時間間隔）
    this.schedulingManager.scheduleIntervalTask(
      'ghost-position-cleanup',
      () => this.runGhostPositionCleanup(),
      360, // 6時間 = 360分
      { description: 'ゴーストポジション削除（6時間間隔）' }
    );
    
    // 5. 週次包括メンテナンス（毎週日曜日 3:00 AM）
    this.schedulingManager.scheduleCustomTask(
      'weekly-maintenance',
      '0 0 3 * * 0', // 毎週日曜日の午前3時
      () => this.runWeeklyMaintenance(),
      { description: '週次包括メンテナンス（毎週日曜日3:00AM）' }
    );
    
    this.isInitialized = true;
    console.log('[メンテナンス] 自動メンテナンススケジュール初期化完了');
    
    // 初期化完了通知
    setTimeout(async () => {
      const message = `🤖 **自動メンテナンスシステム起動**\n` +
                     `━━━━━━━━━━━━━━━━━━━━━━━\n` +
                     `📋 **スケジュール登録完了**:\n` +
                     `• ポジション整合性チェック (2時間間隔)\n` +
                     `• 残高整合性チェック (1時間間隔)\n` +
                     `• 取引所残高比較 (3時間間隔)\n` +
                     `• ゴーストポジション削除 (6時間間隔)\n` +
                     `• 週次包括メンテナンス (日曜3:00AM)\n\n` +
                     `⏰ ${new Date().toLocaleString('ja-JP')}`;
      await postOrderToDiscord(message);
    }, 5000);
  }

  /**
   * 最近の実行結果を取得
   * @returns {Array} 実行結果の配列
   */
  getRecentResults() {
    return Array.from(this.lastResults.entries()).map(([name, result]) => ({
      name,
      ...result
    }));
  }

  /**
   * 手動で特定のメンテナンスタスクを実行
   * @param {string} taskName - タスク名
   * @returns {Object} 実行結果
   */
  async runManualMaintenance(taskName) {
    switch (taskName) {
      case 'position-check':
        return await this.runPositionConsistencyCheck();
      case 'position-fix':
        return await this.runPositionInconsistencyFix();
      case 'balance-check':
        return await this.runBalanceConsistencyCheck();
      case 'exchange-comparison':
        return await this.runExchangeBalanceComparison();
      case 'ghost-cleanup':
        return await this.runGhostPositionCleanup();
      case 'weekly-maintenance':
        return await this.runWeeklyMaintenance();
      default:
        throw new Error(`Unknown maintenance task: ${taskName}`);
    }
  }
}

// シングルトンインスタンス
let maintenanceSchedulerInstance = null;

function getMaintenanceScheduler() {
  if (!maintenanceSchedulerInstance) {
    maintenanceSchedulerInstance = new MaintenanceScheduler();
  }
  return maintenanceSchedulerInstance;
}

module.exports = {
  MaintenanceScheduler,
  getMaintenanceScheduler
};