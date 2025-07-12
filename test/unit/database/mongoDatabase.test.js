const Logger = require('../../../src/hft/utils/Logger');

// MongoDB Database Logger移行のテスト
describe('MongoDB Database Logger移行のテスト', () => {
  let originalConsoleLog, originalConsoleWarn, originalConsoleError;
  let mockLogger;

  beforeEach(() => {
    // 元のconsoleメソッドを保存
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;

    // consoleメソッドをモック
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();

    // Loggerをモック
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    jest.doMock('../../../src/hft/utils/Logger', () => {
      return jest.fn(() => mockLogger);
    });
  });

  afterEach(() => {
    // 元のconsoleメソッドを復元
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;

    jest.clearAllMocks();
    jest.resetModules();
  });

  it('MongoDB DatabaseファイルでLogger instanceが正しく作成される', () => {
    const fs = require('fs');
    const fileContent = fs.readFileSync('src/database/mongoDatabase.js', 'utf8');
    
    expect(fileContent).toContain("const Logger = require('../hft/utils/Logger')");
    expect(fileContent).toContain("const logger = new Logger('MongoDB')");
  });

  it('Logger移行によりconsole.logの直接使用が削除されている', () => {
    // ファイルの内容を読んで、console.logの直接使用がないことを確認
    const fs = require('fs');
    const fileContent = fs.readFileSync('src/database/mongoDatabase.js', 'utf8');
    
    // コメントアウトされたconsole文は除外して、アクティブなconsole文が存在しないことを確認
    const activeConsoleStatements = fileContent.split('\n').filter(line => 
      !line.trim().startsWith('//') && 
      !line.trim().startsWith('*') &&
      (line.includes('console.log') || line.includes('console.warn') || line.includes('console.error'))
    );
    
    expect(activeConsoleStatements).toHaveLength(0);
  });

  it('Logger importが正しく追加されている', () => {
    const fs = require('fs');
    const fileContent = fs.readFileSync('src/database/mongoDatabase.js', 'utf8');
    
    expect(fileContent).toContain("const Logger = require('../hft/utils/Logger')");
    expect(fileContent).toContain("const logger = new Logger('MongoDB')");
  });
});