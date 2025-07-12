const Logger = require('../../../../src/hft/utils/Logger');

describe('Logger クラスのテスト', () => {
  let logger;
  let originalConsoleLog;
  let originalConsoleWarn;
  let originalConsoleError;
  let originalLogLevel;

  beforeEach(() => {
    // コンソールメソッドをモック
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    originalLogLevel = process.env.HFT_LOG_LEVEL;

    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();

    // Logger インスタンスを作成
    logger = new Logger('TestContext');
  });

  afterEach(() => {
    // コンソールメソッドを復元
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    process.env.HFT_LOG_LEVEL = originalLogLevel;
  });

  describe('Logger インスタンス作成', () => {
    it('デフォルトのログレベルがINFOである', () => {
      const testLogger = new Logger('Test');
      expect(testLogger.logLevel).toBe('INFO');
    });

    it('環境変数HFT_LOG_LEVELが設定されている場合、それを使用する', () => {
      process.env.HFT_LOG_LEVEL = 'DEBUG';
      const testLogger = new Logger('Test');
      expect(testLogger.logLevel).toBe('DEBUG');
    });

    it('コンテキストが正しく設定される', () => {
      const testLogger = new Logger('MyContext');
      expect(testLogger.context).toBe('MyContext');
    });

    it('デフォルトコンテキストが設定される', () => {
      const testLogger = new Logger();
      expect(testLogger.context).toBe('General');
    });
  });

  describe('ログレベル判定', () => {
    it('DEBUG レベルで全てのログが出力される', () => {
      process.env.HFT_LOG_LEVEL = 'DEBUG';
      const testLogger = new Logger('Test');
      
      expect(testLogger.shouldLog('DEBUG')).toBe(true);
      expect(testLogger.shouldLog('INFO')).toBe(true);
      expect(testLogger.shouldLog('WARN')).toBe(true);
      expect(testLogger.shouldLog('ERROR')).toBe(true);
    });

    it('INFO レベルでINFO以上のログが出力される', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const testLogger = new Logger('Test');
      
      expect(testLogger.shouldLog('DEBUG')).toBe(false);
      expect(testLogger.shouldLog('INFO')).toBe(true);
      expect(testLogger.shouldLog('WARN')).toBe(true);
      expect(testLogger.shouldLog('ERROR')).toBe(true);
    });

    it('WARN レベルでWARN以上のログが出力される', () => {
      process.env.HFT_LOG_LEVEL = 'WARN';
      const testLogger = new Logger('Test');
      
      expect(testLogger.shouldLog('DEBUG')).toBe(false);
      expect(testLogger.shouldLog('INFO')).toBe(false);
      expect(testLogger.shouldLog('WARN')).toBe(true);
      expect(testLogger.shouldLog('ERROR')).toBe(true);
    });

    it('ERROR レベルでERRORのみが出力される', () => {
      process.env.HFT_LOG_LEVEL = 'ERROR';
      const testLogger = new Logger('Test');
      
      expect(testLogger.shouldLog('DEBUG')).toBe(false);
      expect(testLogger.shouldLog('INFO')).toBe(false);
      expect(testLogger.shouldLog('WARN')).toBe(false);
      expect(testLogger.shouldLog('ERROR')).toBe(true);
    });
  });

  describe('ログメソッドの動作', () => {
    beforeEach(() => {
      process.env.HFT_LOG_LEVEL = 'DEBUG'; // 全てのログを表示
      logger = new Logger('TestContext');
    });

    it('info メソッドが正しく動作する', () => {
      logger.info('テストメッセージ');
      expect(console.log).toHaveBeenCalled();
      
      const logCall = console.log.mock.calls[0][0];
      expect(logCall).toContain('INFO');
      expect(logCall).toContain('TestContext');
      expect(logCall).toContain('テストメッセージ');
    });

    it('warn メソッドが正しく動作する', () => {
      logger.warn('警告メッセージ');
      expect(console.warn).toHaveBeenCalled();
      
      const logCall = console.warn.mock.calls[0][0];
      expect(logCall).toContain('WARN');
      expect(logCall).toContain('TestContext');
      expect(logCall).toContain('警告メッセージ');
    });

    it('error メソッドが正しく動作する', () => {
      logger.error('エラーメッセージ');
      expect(console.error).toHaveBeenCalled();
      
      const logCall = console.error.mock.calls[0][0];
      expect(logCall).toContain('ERROR');
      expect(logCall).toContain('TestContext');
      expect(logCall).toContain('エラーメッセージ');
    });

    it('debug メソッドが正しく動作する', () => {
      logger.debug('デバッグメッセージ');
      expect(console.log).toHaveBeenCalled();
      
      const logCall = console.log.mock.calls[0][0];
      expect(logCall).toContain('DEBUG');
      expect(logCall).toContain('TestContext');
      expect(logCall).toContain('デバッグメッセージ');
    });

    it('success メソッドが正しく動作する', () => {
      logger.success('成功メッセージ');
      expect(console.log).toHaveBeenCalled();
      
      const logCall = console.log.mock.calls[0][0];
      expect(logCall).toContain('TestContext');
      expect(logCall).toContain('成功メッセージ');
      expect(logCall).toContain('✓'); // チェックマーク
    });
  });

  describe('ログレベルフィルタリング', () => {
    it('INFO レベルではDEBUGログが出力されない', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const testLogger = new Logger('Test');
      
      testLogger.debug('デバッグメッセージ');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('WARN レベルではINFOログが出力されない', () => {
      process.env.HFT_LOG_LEVEL = 'WARN';
      const testLogger = new Logger('Test');
      
      testLogger.info('情報メッセージ');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('ERROR レベルではWARNログが出力されない', () => {
      process.env.HFT_LOG_LEVEL = 'ERROR';
      const testLogger = new Logger('Test');
      
      testLogger.warn('警告メッセージ');
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('オブジェクトのログ出力', () => {
    beforeEach(() => {
      process.env.HFT_LOG_LEVEL = 'DEBUG';
      logger = new Logger('TestContext');
    });

    it('オブジェクトがJSON形式で出力される', () => {
      const testObj = { key: 'value', number: 42 };
      logger.info('テストオブジェクト:', testObj);
      
      expect(console.log).toHaveBeenCalled();
      const logCall = console.log.mock.calls[0][0];
      expect(logCall).toContain('テストオブジェクト:');
      expect(logCall).toContain(JSON.stringify(testObj, null, 2));
    });

    it('複数の引数が正しく処理される', () => {
      logger.info('メッセージ', 'arg1', 'arg2');
      
      expect(console.log).toHaveBeenCalled();
      const logCall = console.log.mock.calls[0][0];
      expect(logCall).toContain('メッセージ');
      expect(logCall).toContain('arg1');
      expect(logCall).toContain('arg2');
    });
  });

  describe('プロダクション環境での動作', () => {
    it('本番環境（INFO）ではDEBUGログが出力されない', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const prodLogger = new Logger('Production');
      
      prodLogger.debug('[DEBUG] 詳細なデバッグ情報');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('本番環境（INFO）ではINFOログが出力される', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const prodLogger = new Logger('Production');
      
      prodLogger.info('重要な情報');
      expect(console.log).toHaveBeenCalled();
    });

    it('本番環境（INFO）ではWARNログが出力される', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const prodLogger = new Logger('Production');
      
      prodLogger.warn('注意が必要な状況');
      expect(console.warn).toHaveBeenCalled();
    });

    it('本番環境（INFO）ではERRORログが出力される', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const prodLogger = new Logger('Production');
      
      prodLogger.error('エラーが発生しました');
      expect(console.error).toHaveBeenCalled();
    });
  });
});