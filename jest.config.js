module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testTimeout: 60000, // CI/CD安定性のため60秒に延長
  // キャッシュディレクトリを/tmpに設定してキャッシュ問題を回避
  cacheDirectory: '/tmp/jest_cache',
  // Ignore E2E tests in unit test runs
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/e2e.*\\.js$'
  ]
};