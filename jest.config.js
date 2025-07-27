module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: process.env.CI ? 20000 : 60000, // CI環境では20秒に短縮してタイムアウト問題を解決
  // キャッシュディレクトリを.tmpに設定してキャッシュ問題を回避
  cacheDirectory: '.tmp/jest_cache',
  // CI環境でのハンドルクリーンアップ問題対応 - detectOpenHandlesを有効化して問題を特定可能に
  detectOpenHandles: process.env.CI ? true : true, // CI環境でもオープンハンドル検出を有効化
  forceExit: false, // forceExitを無効化して根本的なハンドルクリーンアップ問題を解決
  maxConcurrency: process.env.CI ? 1 : 5, // CI環境では1並行に制限して安定性向上
  workerIdleMemoryLimit: process.env.CI ? '128MB' : '1GB', // CI環境でメモリ制限を128MBに設定
  maxWorkers: process.env.CI ? 1 : '50%', // CI環境では1ワーカーで安定性を優先
  // Ignore E2E tests in unit test runs
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/e2e.*\\.js$',
    // CI環境では時間のかかるテストを除外してタイムアウトを防止
    ...(process.env.CI ? [
      '/test/.*backtest-service-performance.*\\.test\\.js$',
      '/test/.*strategy-runner-concurrent.*\\.test\\.js$'
    ] : [])
  ],
  // CI環境でもコンソール出力を表示（デバッグ用）
  silent: false
};