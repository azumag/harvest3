module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: process.env.CI ? 30000 : 60000, // CI環境では30秒に短縮
  // キャッシュディレクトリを.tmpに設定してキャッシュ問題を回避
  cacheDirectory: '.tmp/jest_cache',
  // オープンハンドルによるハング問題を解決するため強制終了を有効化
  forceExit: true,
  // CI環境での安定性向上
  detectOpenHandles: process.env.CI ? false : true, // CI環境では無効化
  maxConcurrency: process.env.CI ? 1 : 5, // CI環境では並行実行を制限
  workerIdleMemoryLimit: process.env.CI ? '256MB' : '512MB',
  // Ignore E2E tests in unit test runs
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/e2e.*\\.js$'
  ],
  // CI環境でのコンソール出力を抑制
  silent: process.env.CI ? true : false
};