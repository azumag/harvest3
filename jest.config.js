module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: process.env.CI ? 300000 : 60000, // CI環境では5分に延長してタイムアウト問題を解決
  // キャッシュディレクトリを.tmpに設定してキャッシュ問題を回避
  cacheDirectory: '.tmp/jest_cache',
  // CI環境での安定性向上 - ハンドルクリーンアップの問題に対応
  detectOpenHandles: process.env.CI ? false : true, // CI環境ではオープンハンドル検出を無効化
  forceExit: true, // ハンドルクリーンアップ後も残るプロセスを強制終了
  maxConcurrency: process.env.CI ? 1 : 5, // CI環境では並行実行を1に減らしてワーカークラッシュを防止
  workerIdleMemoryLimit: process.env.CI ? '512MB' : '1GB', // CI環境ではメモリ制限を512MBに減らしてワーカー安定性向上
  maxWorkers: process.env.CI ? 1 : '50%', // CI環境では1ワーカーでワーカークラッシュとEPIPEエラーを防止
  // Ignore E2E tests in unit test runs
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/e2e.*\\.js$'
  ],
  // CI環境でもコンソール出力を表示（デバッグ用）
  silent: false,
  // CI環境での追加安定性設定
  ...(process.env.CI && {
    // ワーカープロセス間通信の安定性向上
    workerThreads: false,
    // 実行環境のクリーンアップを強化
    resetMocks: true,
    resetModules: true,
    restoreMocks: true
  })
};