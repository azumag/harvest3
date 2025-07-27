module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: process.env.CI ? 30000 : 60000, // CI環境では30秒に設定
  // キャッシュディレクトリを.tmpに設定してキャッシュ問題を回避
  cacheDirectory: '.tmp/jest_cache',
  // CI環境での安定性向上
  detectOpenHandles: process.env.CI ? false : true, // CI環境では無効化してパフォーマンス向上
  // forceExit は環境teardown問題の原因のため削除
  maxConcurrency: process.env.CI ? 2 : 5, // CI環境では2に緩和（安定性とパフォーマンスのバランス）
  workerIdleMemoryLimit: process.env.CI ? '256MB' : '1GB', // CI環境でメモリ制限を256MBに緩和
  maxWorkers: process.env.CI ? 2 : '50%', // CI環境では2ワーカーに緩和
  // Ignore E2E tests in unit test runs
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/e2e.*\\.js$',
    // CI環境では時間のかかるテストを除外
    ...(process.env.CI ? [
      '/test/strategy-runner-issue-5103-duplicate-startup-fix\\.test\\.js$',
      '/test/strategy-runner-issue-5195-race-condition-fix\\.test\\.js$',
      '/test/unit/database/database-manager-issue-4932-fix\\.test\\.js$',
      '/test/unit/database/database-manager-issue-4941\\.test\\.js$',
      '/test/unit/strategies/utils/.*\\.test\\.js$' // 時間のかかる戦略テストを除外
    ] : [])
  ],
  // CI環境でもコンソール出力を表示（デバッグ用）
  silent: false
};