module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: process.env.CI ? 60000 : 60000, // CI環境でも60秒に設定してDiscord rate limiterテスト等の長時間実行テストに対応
  // キャッシュディレクトリを.tmpに設定してキャッシュ問題を回避
  cacheDirectory: '.tmp/jest_cache',
  // CI環境での安定性向上 - ハンドルクリーンアップの問題に対応
  detectOpenHandles: process.env.CI ? false : true, // CI環境ではオープンハンドル検出を無効化
  forceExit: true, // ハンドルクリーンアップ後も残るプロセスを強制終了
  maxConcurrency: process.env.CI ? 4 : 5, // CI環境では並行実行を4に制限（パフォーマンス最適化）
  workerIdleMemoryLimit: process.env.CI ? '256MB' : '1GB', // CI環境でメモリ制限を256MBに設定して安定性向上
  maxWorkers: process.env.CI ? 4 : '50%', // CI環境では4ワーカーでパフォーマンス最適化
  // Ignore E2E tests in unit test runs
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/e2e.*\\.js$'
  ],
  // CI環境でもコンソール出力を表示（デバッグ用）
  silent: false
};