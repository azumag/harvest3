describe('isTestEnvironment', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('NODE_ENV=testの場合はtrueを返す', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DOCKER_ENV;
    delete process.env.CI;
    delete process.env.BB_API_KEY;
    delete process.env.BB_API_SECRET;
    
    // configモジュールを再読み込み
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('DOCKER_ENV=trueの場合はtrueを返す', () => {
    delete process.env.NODE_ENV;
    process.env.DOCKER_ENV = 'true';
    delete process.env.CI;
    delete process.env.BB_API_KEY;
    delete process.env.BB_API_SECRET;
    
    // configモジュールを再読み込み
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('API認証情報が未設定の場合はtrueを返す', () => {
    delete process.env.NODE_ENV;
    delete process.env.DOCKER_ENV;
    process.env.CI = 'false';
    delete process.env.BB_API_KEY;
    delete process.env.BB_API_SECRET;
    
    // configモジュールを再読み込み
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #824: CI環境でAPI認証情報が未設定の場合もtrueを返す', () => {
    delete process.env.NODE_ENV;
    delete process.env.DOCKER_ENV;
    process.env.CI = 'true';
    delete process.env.BB_API_KEY;
    delete process.env.BB_API_SECRET;
    
    // configモジュールを再読み込み
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('本番環境（API認証情報が設定済み）の場合はfalseを返す', () => {
    delete process.env.NODE_ENV;
    delete process.env.DOCKER_ENV;
    process.env.CI = 'false';
    process.env.BB_API_KEY = 'test_key';
    process.env.BB_API_SECRET = 'test_secret';
    
    // configモジュールを再読み込みしてAPIキーを反映
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(false);
  });

  test('NODE_ENV=testが最優先される', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DOCKER_ENV;
    process.env.CI = 'false';
    process.env.BB_API_KEY = 'test_key';
    process.env.BB_API_SECRET = 'test_secret';
    
    // configモジュールを再読み込みしてAPIキーを反映
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('DOCKER_ENV=trueが2番目に優先される', () => {
    delete process.env.NODE_ENV;
    process.env.DOCKER_ENV = 'true';
    process.env.CI = 'false';
    process.env.BB_API_KEY = 'test_key';
    process.env.BB_API_SECRET = 'test_secret';
    
    // configモジュールを再読み込みしてAPIキーを反映
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #5095: BACKTEST_MODE=trueの場合はtrueを返す', () => {
    delete process.env.NODE_ENV;
    delete process.env.DOCKER_ENV;
    process.env.BACKTEST_MODE = 'true';
    process.env.CI = 'false';
    delete process.env.BB_API_KEY;
    delete process.env.BB_API_SECRET;
    
    // configモジュールを再読み込み
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #5095: BACKTEST_MODE=trueが3番目に優先される', () => {
    delete process.env.NODE_ENV;
    delete process.env.DOCKER_ENV;
    process.env.BACKTEST_MODE = 'true';
    process.env.CI = 'false';
    process.env.BB_API_KEY = 'test_key';
    process.env.BB_API_SECRET = 'test_secret';
    
    // configモジュールを再読み込みしてAPIキーを反映
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #5095: NODE_ENVがBACKTEST_MODEより優先される', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DOCKER_ENV;
    process.env.BACKTEST_MODE = 'true';
    process.env.CI = 'false';
    process.env.BB_API_KEY = 'test_key';
    process.env.BB_API_SECRET = 'test_secret';
    
    // configモジュールを再読み込みしてAPIキーを反映
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('Issue #5095: DOCKER_ENVがBACKTEST_MODEより優先される', () => {
    delete process.env.NODE_ENV;
    process.env.DOCKER_ENV = 'true';
    process.env.BACKTEST_MODE = 'true';
    process.env.CI = 'false';
    process.env.BB_API_KEY = 'test_key';
    process.env.BB_API_SECRET = 'test_secret';
    
    // configモジュールを再読み込みしてAPIキーを反映
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('API認証情報の片方だけが設定されている場合はtrueを返す', () => {
    delete process.env.NODE_ENV;
    delete process.env.DOCKER_ENV;
    process.env.CI = 'false';
    process.env.BB_API_KEY = 'test_key';
    delete process.env.BB_API_SECRET;
    
    // configモジュールを再読み込み
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });

  test('API認証情報の片方だけが設定されている場合（secretのみ）はtrueを返す', () => {
    delete process.env.NODE_ENV;
    delete process.env.DOCKER_ENV;
    process.env.CI = 'false';
    delete process.env.BB_API_KEY;
    process.env.BB_API_SECRET = 'test_secret';
    
    // configモジュールを再読み込み
    delete require.cache[require.resolve('../../../src/config')];
    const config = require('../../../src/config');
    
    expect(config.isTestEnvironment()).toBe(true);
  });
});