#!/usr/bin/env node

// Extended Walk-Forward Backtest with Progress Reporting
// Timeout: 10 minutes, Progress reports every 5 minutes

const { spawn } = require('child_process');
const { promisify } = require('util');

const BACKTEST_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const PROGRESS_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function runExtendedWalkForward() {
  console.log('🚀 Extended Walk-Forward Analysis開始...');
  console.log(`⏰ タイムアウト: ${BACKTEST_TIMEOUT / 1000}秒`);
  console.log(`📊 進捗報告間隔: ${PROGRESS_INTERVAL / 1000}秒`);
  
  const startTime = Date.now();
  let progressReportCount = 0;
  
  // 進捗報告用のタイマー
  const progressTimer = setInterval(() => {
    progressReportCount++;
    const elapsed = Date.now() - startTime;
    const elapsedMinutes = Math.floor(elapsed / 60000);
    const remaining = Math.max(0, Math.floor((BACKTEST_TIMEOUT - elapsed) / 60000));
    
    console.log(`⏳ 進捗報告 #${progressReportCount}: ${elapsedMinutes}分経過, 残り約${remaining}分`);
    
    // manager-claudeに進捗報告
    const reportCmd = spawn('tmux', [
      'send-keys', '-t', 'manager-claude',
      `worker-claude進捗 #${progressReportCount}: Walk-Forward分析実行中、${elapsedMinutes}分経過、残り${remaining}分、Redis修正済み、実測値計算中`,
      'Enter'
    ]);
    
    setTimeout(() => {
      spawn('tmux', ['send-keys', '-t', 'manager-claude', '', 'Enter']);
    }, 10000);
    
  }, PROGRESS_INTERVAL);
  
  return new Promise((resolve, reject) => {
    console.log('💻 バックテスト実行中...');
    
    const backtest = spawn('node', [
      'src/backtestRunner.js', 
      'BTC/JPY', 
      '--walk-forward', 
      '--monte-carlo', 
      '--overfitting-detection'
    ], {
      env: {
        ...process.env,
        REDIS_URL: 'redis://localhost:6379',
        MONGO_URL: 'mongodb://localhost:27017',
        MONGO_DB_NAME: 'harvest3'
      },
      stdio: 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    backtest.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      
      // リアルタイム出力（重要な情報のみ）
      if (chunk.includes('Walk-Forward') || 
          chunk.includes('Monte Carlo') || 
          chunk.includes('期間') ||
          chunk.includes('Sharpe') ||
          chunk.includes('完了')) {
        console.log('📊', chunk.trim());
      }
    });
    
    backtest.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      
      // エラー出力
      if (chunk.includes('Error') || chunk.includes('❌')) {
        console.error('❌', chunk.trim());
      }
    });
    
    backtest.on('close', (code) => {
      clearInterval(progressTimer);
      const elapsed = Date.now() - startTime;
      
      console.log(`🏁 バックテスト終了: ${Math.floor(elapsed / 60000)}分${Math.floor((elapsed % 60000) / 1000)}秒`);
      console.log(`📋 終了コード: ${code}`);
      
      if (code === 0) {
        console.log('✅ 正常終了');
        resolve({ 
          success: true, 
          stdout, 
          stderr, 
          elapsed,
          exitCode: code 
        });
      } else {
        console.log('❌ 異常終了');
        reject(new Error(`バックテストが異常終了しました (コード: ${code})`));
      }
    });
    
    backtest.on('error', (error) => {
      clearInterval(progressTimer);
      console.error('🚨 プロセスエラー:', error);
      reject(error);
    });
    
    // タイムアウト設定
    setTimeout(() => {
      if (!backtest.killed) {
        console.log('⏰ タイムアウトに達しました');
        backtest.kill('SIGTERM');
        clearInterval(progressTimer);
        
        // 部分結果の解析を試行
        resolve({
          success: false,
          timeout: true,
          stdout,
          stderr,
          elapsed: BACKTEST_TIMEOUT,
          exitCode: null
        });
      }
    }, BACKTEST_TIMEOUT);
  });
}

// 結果の解析と報告
function analyzeResults(result) {
  console.log('🔍 結果解析中...');
  
  const metrics = {
    sharpeRatio: null,
    maxDrawdown: null,
    cumulativeReturn: null,
    totalPeriods: null,
    winRate: null,
    completed: !result.timeout
  };
  
  // stdout から実際の数値を抽出
  if (result.stdout) {
    const sharpeMatch = result.stdout.match(/シャープ[レラ]シオ[：:]\s*([0-9.-]+)/);
    if (sharpeMatch) metrics.sharpeRatio = parseFloat(sharpeMatch[1]);
    
    const drawdownMatch = result.stdout.match(/ドローダウン[：:]\s*([0-9.-]+)%/);
    if (drawdownMatch) metrics.maxDrawdown = parseFloat(drawdownMatch[1]);
    
    const returnMatch = result.stdout.match(/累積リターン[：:]\s*([0-9.-]+)%/);
    if (returnMatch) metrics.cumulativeReturn = parseFloat(returnMatch[1]);
    
    const periodMatch = result.stdout.match(/総?期間数[：:]\s*([0-9]+)/);
    if (periodMatch) metrics.totalPeriods = parseInt(periodMatch[1]);
    
    const winMatch = result.stdout.match(/勝率[：:]\s*([0-9.-]+)%/);
    if (winMatch) metrics.winRate = parseFloat(winMatch[1]);
  }
  
  return metrics;
}

// 最終報告
function generateFinalReport(result, metrics) {
  const report = [];
  
  report.push('## 🎯 Walk-Forward Analysis 実測結果');
  report.push('```');
  
  if (result.timeout) {
    report.push('⏰ タイムアウト: 10分制限に達しました');
    report.push('📊 部分結果解析:');
  } else {
    report.push('✅ 完了: 正常に終了しました');
    report.push('📊 最終実測結果:');
  }
  
  report.push(`実行時間: ${Math.floor(result.elapsed / 60000)}分${Math.floor((result.elapsed % 60000) / 1000)}秒`);
  
  if (metrics.sharpeRatio !== null) {
    report.push(`シャープレシオ: ${metrics.sharpeRatio.toFixed(4)}`);
  } else {
    report.push('シャープレシオ: 測定不可');
  }
  
  if (metrics.maxDrawdown !== null) {
    report.push(`最大ドローダウン: ${metrics.maxDrawdown.toFixed(2)}%`);
  } else {
    report.push('最大ドローダウン: 測定不可');
  }
  
  if (metrics.cumulativeReturn !== null) {
    report.push(`累積リターン: ${metrics.cumulativeReturn.toFixed(2)}%`);
  } else {
    report.push('累積リターン: 測定不可');
  }
  
  if (metrics.totalPeriods !== null) {
    report.push(`処理期間数: ${metrics.totalPeriods}`);
  } else {
    report.push('処理期間数: 測定不可');
  }
  
  if (metrics.winRate !== null) {
    report.push(`勝率: ${metrics.winRate.toFixed(1)}%`);
  } else {
    report.push('勝率: 測定不可');
  }
  
  report.push('```');
  
  return report.join('\n');
}

// メイン実行
async function main() {
  try {
    console.log('🔧 Redis修正済み、Extended Walk-Forward Analysis開始');
    
    const result = await runExtendedWalkForward();
    const metrics = analyzeResults(result);
    const finalReport = generateFinalReport(result, metrics);
    
    console.log('\n' + finalReport);
    
    // manager-claudeに最終報告
    const reportCmd = spawn('tmux', [
      'send-keys', '-t', 'manager-claude',
      `worker-claude最終報告: Walk-Forward分析完了。${finalReport.replace(/\n/g, ' ').replace(/```/g, '')}`,
      'Enter'
    ]);
    
    setTimeout(() => {
      spawn('tmux', ['send-keys', '-t', 'manager-claude', '', 'Enter']);
    }, 10000);
    
    process.exit(result.success ? 0 : 1);
    
  } catch (error) {
    console.error('🚨 実行エラー:', error.message);
    
    // エラー報告
    const errorCmd = spawn('tmux', [
      'send-keys', '-t', 'manager-claude',
      `worker-claude エラー報告: ${error.message}`,
      'Enter'
    ]);
    
    setTimeout(() => {
      spawn('tmux', ['send-keys', '-t', 'manager-claude', '', 'Enter']);
    }, 10000);
    
    process.exit(1);
  }
}

// 実行
main().catch(console.error);