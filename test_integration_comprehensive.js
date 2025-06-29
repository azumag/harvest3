#!/usr/bin/env node

// Comprehensive Integration Test for Backtest System
const { spawn } = require('child_process');
const fs = require('fs');

console.log('🚀 Comprehensive Integration Test 開始');

async function runTest() {
  console.log('\n=== Phase 1: Infrastructure Tests ===');
  
  // Redis test
  console.log('📡 Redis接続テスト...');
  const redisTest = spawn('docker', ['exec', 'harvest3-redis', 'redis-cli', 'ping']);
  const redisOk = await new Promise((resolve) => {
    redisTest.on('close', (code) => resolve(code === 0));
  });
  console.log(`Redis: ${redisOk ? '✅' : '❌'}`);
  
  // MongoDB test  
  console.log('📡 MongoDB接続テスト...');
  const mongoTest = spawn('docker', ['exec', 'harvest3-mongodb', 'mongosh', '--eval', 'db.runCommand("ping")']);
  const mongoOk = await new Promise((resolve) => {
    mongoTest.on('close', (code) => resolve(code === 0));
  });
  console.log(`MongoDB: ${mongoOk ? '✅' : '❌'}`);
  
  // OHLCV test
  console.log('📈 OHLCV取得テスト...');
  const ohlcvTest = spawn('node', ['emergency_test_ohlcv_fetch.js']);
  const ohlcvOk = await new Promise((resolve) => {
    let output = '';
    ohlcvTest.stdout.on('data', (data) => { output += data; });
    ohlcvTest.on('close', (code) => {
      resolve(code === 0 && output.includes('success: true'));
    });
  });
  console.log(`OHLCV: ${ohlcvOk ? '✅' : '❌'}`);
  
  console.log('\n=== Phase 2: Basic Backtest ===');
  console.log('🔬 基本バックテスト実行...');
  
  const basicTest = spawn('node', ['src/backtestRunner.js', 'BTC/JPY'], {
    env: {
      ...process.env,
      REDIS_URL: 'redis://localhost:6379',
      MONGO_URL: 'mongodb://localhost:27017',
      MONGO_DB_NAME: 'harvest3'
    }
  });
  
  const basicResult = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    
    basicTest.stdout.on('data', (data) => { stdout += data; });
    basicTest.stderr.on('data', (data) => { stderr += data; });
    
    const timeout = setTimeout(() => {
      basicTest.kill();
      const hasData = stdout.includes('データ取得完了') || stdout.includes('バックテスト完了');
      const hasStrategy = stdout.includes('パラメータ最適化結果');
      console.log(`データ取得: ${hasData ? '✅' : '❌'}`);
      console.log(`戦略実行: ${hasStrategy ? '✅' : '❌'}`);
      resolve({ hasData, hasStrategy, timeout: true });
    }, 90000); // 90秒
    
    basicTest.on('close', (code) => {
      clearTimeout(timeout);
      const hasData = stdout.includes('データ取得完了') || stdout.includes('バックテスト完了');
      const hasStrategy = stdout.includes('パラメータ最適化結果');
      console.log(`バックテスト終了コード: ${code}`);
      console.log(`データ取得: ${hasData ? '✅' : '❌'}`);
      console.log(`戦略実行: ${hasStrategy ? '✅' : '❌'}`);
      resolve({ hasData, hasStrategy, timeout: false, code });
    });
  });
  
  console.log('\n=== Phase 3: Advanced Features ===');
  console.log('🧪 Advanced Features テスト...');
  
  const advancedTest = spawn('node', [
    'src/backtestRunner.js', 'BTC/JPY', 
    '--monte-carlo', '--walk-forward'
  ], {
    env: {
      ...process.env,
      REDIS_URL: 'redis://localhost:6379',
      MONGO_URL: 'mongodb://localhost:27017',
      MONGO_DB_NAME: 'harvest3'
    }
  });
  
  const advancedResult = await new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    
    advancedTest.stdout.on('data', (data) => { stdout += data; });
    advancedTest.stderr.on('data', (data) => { stderr += data; });
    
    const timeout = setTimeout(() => {
      advancedTest.kill();
      const hasMC = stdout.includes('Monte Carlo') && stdout.includes('完了');
      const hasWF = stdout.includes('Walk-Forward') && stdout.includes('実行');
      const hasMetrics = stdout.includes('シャープレシオ') || stdout.includes('ドローダウン');
      console.log(`Monte Carlo: ${hasMC ? '✅' : '❌'}`);
      console.log(`Walk-Forward: ${hasWF ? '✅' : '❌'}`);
      console.log(`Advanced Metrics: ${hasMetrics ? '✅' : '❌'}`);
      resolve({ hasMC, hasWF, hasMetrics, timeout: true });
    }, 120000); // 120秒
    
    advancedTest.on('close', (code) => {
      clearTimeout(timeout);
      const hasMC = stdout.includes('Monte Carlo') && stdout.includes('完了');
      const hasWF = stdout.includes('Walk-Forward') && stdout.includes('実行');
      const hasMetrics = stdout.includes('シャープレシオ') || stdout.includes('ドローダウン');
      console.log(`Advanced Features終了コード: ${code}`);
      console.log(`Monte Carlo: ${hasMC ? '✅' : '❌'}`);
      console.log(`Walk-Forward: ${hasWF ? '✅' : '❌'}`);
      console.log(`Advanced Metrics: ${hasMetrics ? '✅' : '❌'}`);
      resolve({ hasMC, hasWF, hasMetrics, timeout: false, code });
    });
  });
  
  // 結果集計
  console.log('\n=== 📊 最終結果 ===');
  const scores = [
    redisOk, mongoOk, ohlcvOk,
    basicResult.hasData, basicResult.hasStrategy,
    advancedResult.hasMC, advancedResult.hasWF, advancedResult.hasMetrics
  ];
  
  const totalScore = scores.filter(Boolean).length;
  const percentage = Math.round((totalScore / 8) * 100);
  const status = percentage >= 70 ? '✅ PASS' : percentage >= 50 ? '⚠️ PARTIAL' : '❌ FAIL';
  
  console.log(`Infrastructure: ${[redisOk, mongoOk, ohlcvOk].filter(Boolean).length}/3`);
  console.log(`Basic Backtest: ${[basicResult.hasData, basicResult.hasStrategy].filter(Boolean).length}/2`);
  console.log(`Advanced Features: ${[advancedResult.hasMC, advancedResult.hasWF, advancedResult.hasMetrics].filter(Boolean).length}/3`);
  console.log(`\n🎯 総合評価: ${totalScore}/8 (${percentage}%) ${status}`);
  
  // Manager-claude への報告
  const reportMessage = `worker-claude 統合テスト完了: 総合${percentage}%${status} Infrastructure${[redisOk,mongoOk,ohlcvOk].filter(Boolean).length}/3 Basic${[basicResult.hasData,basicResult.hasStrategy].filter(Boolean).length}/2 Advanced${[advancedResult.hasMC,advancedResult.hasWF,advancedResult.hasMetrics].filter(Boolean).length}/3`;
  
  const report = spawn('tmux', ['send-keys', '-t', 'manager-claude', reportMessage, 'Enter']);
  setTimeout(() => {
    spawn('tmux', ['send-keys', '-t', 'manager-claude', '', 'Enter']);
  }, 10000);
  
  // 詳細ログ保存
  const detailedResults = {
    timestamp: new Date().toISOString(),
    infrastructure: { redis: redisOk, mongo: mongoOk, ohlcv: ohlcvOk },
    basicBacktest: basicResult,
    advancedFeatures: advancedResult,
    totalScore,
    percentage,
    status
  };
  
  fs.writeFileSync('integration_test_results.json', JSON.stringify(detailedResults, null, 2));
  console.log('📄 詳細結果保存: integration_test_results.json');
  
  process.exit(percentage >= 50 ? 0 : 1);
}

runTest().catch(console.error);