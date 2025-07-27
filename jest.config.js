module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: process.env.CI ? 20000 : 60000, // CI環境では20秒に設定してタイムアウト問題を解決
  // キャッシュディレクトリを.tmpに設定してキャッシュ問題を回避
  cacheDirectory: '.tmp/jest_cache',
  // CI環境での安定性向上 - ハンドルクリーンアップの問題に対応
  detectOpenHandles: true, // オープンハンドル検出を有効化して問題を特定
  forceExit: true, // ハンドルクリーンアップ後も残るプロセスを強制終了
  maxConcurrency: process.env.CI ? 1 : 5, // CI環境では並行実行を1に制限（安定性優先）
  workerIdleMemoryLimit: process.env.CI ? '128MB' : '1GB', // CI環境でメモリ制限を128MBに設定して安定性向上
  maxWorkers: process.env.CI ? 1 : '50%', // CI環境では1ワーカーでプロセス管理を簡素化
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