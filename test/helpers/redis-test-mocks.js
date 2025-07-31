/**
 * 共通テストモックヘルパー: Redis接続テスト用
 * Issue #5755修正: テストコードの重複削減とDRY原則準拠
 */

/**
 * 標準的なRedisクライアントモックを作成
 * @param {Object} overrides - オーバーライドするプロパティ
 * @returns {Object} モックRedisクライアント
 */
const createMockRedisClient = (overrides = {}) => ({
  isReady: true,
  isOpen: true,
  status: 'ready',
  serverInfo: { version: '6.2.0' },
  constructor: { name: 'RedisClient' },
  ...overrides
});

/**
 * モックロガーを作成
 * @returns {Object} モックロガー
 */
const createMockLogger = () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
});

/**
 * 接続失敗状態のRedisクライアントモック
 * @returns {Object} 接続失敗モック
 */
const createDisconnectedRedisClient = () => createMockRedisClient({
  isReady: false,
  isOpen: false,
  status: 'disconnected'
});

/**
 * undefined プロパティを持つRedisクライアントモック
 * @returns {Object} undefined プロパティモック
 */
const createUndefinedPropertiesRedisClient = () => createMockRedisClient({
  isReady: undefined,
  isOpen: undefined,
  status: 'connecting',
  serverInfo: undefined
});

module.exports = {
  createMockRedisClient,
  createMockLogger,
  createDisconnectedRedisClient,
  createUndefinedPropertiesRedisClient
};