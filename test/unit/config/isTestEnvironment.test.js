describe('isTestEnvironment', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ヘルパー関数：configモジュールを再読み込み
  function reloadConfig() {
    delete require.cache[require.resolve('../../../src/config')];
    return require('../../../src/config');
  }

  // ヘルパー関数：テスト環境変数を設定
  function setTestEnvironment(envVars = {}) {
    // 全ての関連環境変数をクリア
    const keysToDelete = ['NODE_ENV', 'DOCKER_ENV', 'BACKTEST_MODE', 'CI', 'BB_API_KEY', 'BB_API_SECRET'];
    keysToDelete.forEach(key => delete process.env[key]);
    
    // 指定された環境変数を設定
    Object.assign(process.env, envVars);
    
    return reloadConfig();
  }

  test('NODE_ENV=testの場合はtrueを返す', () => {
    const config = setTestEnvironment({ NODE_ENV: 'test' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('DOCKER_ENV=trueの場合はtrueを返す', () => {
    const config = setTestEnvironment({ DOCKER_ENV: 'true' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('API認証情報が未設定の場合はtrueを返す', () => {
    const config = setTestEnvironment({ CI: 'false' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #824: CI環境でAPI認証情報が未設定の場合もtrueを返す', () => {
    const config = setTestEnvironment({ CI: 'true' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('本番環境（API認証情報が設定済み）の場合はfalseを返す', () => {
    const config = setTestEnvironment({ CI: 'false', BB_API_KEY: 'test_key', BB_API_SECRET: 'test_secret' });
    expect(config.isTestEnvironment()).toBe(false);
  });

  test('NODE_ENV=testが最優先される', () => {
    const config = setTestEnvironment({ NODE_ENV: 'test', CI: 'false', BB_API_KEY: 'test_key', BB_API_SECRET: 'test_secret' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('DOCKER_ENV=trueが2番目に優先される', () => {
    const config = setTestEnvironment({ DOCKER_ENV: 'true', CI: 'false', BB_API_KEY: 'test_key', BB_API_SECRET: 'test_secret' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #5095: BACKTEST_MODE=trueの場合はtrueを返す', () => {
    const config = setTestEnvironment({ BACKTEST_MODE: 'true', CI: 'false' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #5095: BACKTEST_MODE=trueが3番目に優先される', () => {
    const config = setTestEnvironment({ BACKTEST_MODE: 'true', CI: 'false', BB_API_KEY: 'test_key', BB_API_SECRET: 'test_secret' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #5095: NODE_ENVがBACKTEST_MODEより優先される', () => {
    const config = setTestEnvironment({ NODE_ENV: 'test', BACKTEST_MODE: 'true', CI: 'false', BB_API_KEY: 'test_key', BB_API_SECRET: 'test_secret' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #5095: DOCKER_ENVがBACKTEST_MODEより優先される', () => {
    const config = setTestEnvironment({ DOCKER_ENV: 'true', BACKTEST_MODE: 'true', CI: 'false', BB_API_KEY: 'test_key', BB_API_SECRET: 'test_secret' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('API認証情報の片方だけが設定されている場合はtrueを返す', () => {
    const config = setTestEnvironment({ CI: 'false', BB_API_KEY: 'test_key' });
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('API認証情報の片方だけが設定されている場合（secretのみ）はtrueを返す', () => {
    const config = setTestEnvironment({ CI: 'false', BB_API_SECRET: 'test_secret' });
    expect(config.isTestEnvironment()).toBe(true);
  });
});