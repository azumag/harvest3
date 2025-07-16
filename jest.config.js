module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: process.env.CI ? 45000 : 60000, // CI環境では45秒に調整（30秒は短すぎる可能性）
  // キャッシュディレクトリを.tmpに設定してキャッシュ問題を回避
  cacheDirectory: '.tmp/jest_cache',
  // CI環境での安定性向上 - ハンドルクリーンアップの問題に対応
  detectOpenHandles: process.env.CI ? false : true, // CI環境ではオープンハンドル検出を無効化
  forceExit: true, // ハンドルクリーンアップ後も残るプロセスを強制終了
  maxConcurrency: process.env.CI ? 2 : 5, // CI環境では並行実行を2に制限（安定性とパフォーマンスのバランス）
  workerIdleMemoryLimit: process.env.CI ? '512MB' : '1GB', // CI環境でメモリ制限を512MBに設定（現代のテストスイートに対応）
  maxWorkers: process.env.CI ? 2 : '50%', // CI環境では2ワーカーで安定性とパフォーマンスのバランス
  // Ignore E2E tests in unit test runs
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/e2e.*\\.js$'
  ],
  // CI環境でもコンソール出力を表示（デバッグ用）
  silent: false
};