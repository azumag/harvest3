/**
 * Issue #5755: Redis接続チェックの統合テスト
 *
 * HARVEST3_TEST_REDIS_URL が設定されている場合のみ実Redisへ接続して
 * validateRedisClientConnection の実クライアント互換性を検証する。
 * 未設定のCI/ローカルでは自動でスキップされ、既存スイートに影響しない。
 */
const REDIS_URL = process.env.HARVEST3_TEST_REDIS_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis('Redis connection check integration (実Redis)', () => {
  let client;
  let validateRedisClientConnection;
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

  beforeAll(async () => {
    ({ validateRedisClientConnection } = require('../../src/database/manager'));
    const { createClient } = require('redis');
    client = createClient({ url: REDIS_URL });
    await client.connect();
  });

  afterAll(async () => {
    if (client && client.isOpen) await client.quit();
  });

  test('接続済みクライアントは isReady/isOpen が真で検証を通過する', async () => {
    const result = await validateRedisClientConnection(client, 'integration-test', logger);
    expect(result).toEqual(expect.objectContaining({ clientReady: true, clientOpen: true }));
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('切断後のクライアントは実行可能と判定されない', async () => {
    await client.quit();
    await expect(
      validateRedisClientConnection(client, 'integration-test-closed', logger)
    ).resolves.not.toEqual(expect.objectContaining({ clientReady: true, clientOpen: true }));
  });
});
