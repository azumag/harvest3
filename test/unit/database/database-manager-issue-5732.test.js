/**
 * Issue #5732: strategy-runnerサービスでのRedis接続例外に対するテスト
 * ready=undefined, open=undefinedエラーの修正に対するテスト
 */

// Jest テストフレームワークを使用
jest.unmock('../../../src/database/manager');

describe('Issue #5732: Redis接続状態undefinedエラーの改善テスト', () => {
  let mockRedisClient;
  let mockRedisDatabase;
  let mockLogger;
  let databaseManager;

  beforeEach(() => {
    // Jest のモックキャッシュをクリア
    jest.resetModules();
    
    // モックロガーの初期化
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    };

    // Redis v4.x でisReady/isOpenがundefinedになるクライアントモック
    mockRedisClient = {
      multi: jest.fn(),
      isReady: undefined,
      isOpen: undefined,
      status: 'connecting',
      ping: jest.fn().mockResolvedValue('PONG'),
      constructor: { name: 'Redis' }
    };

    // redisDatabase モック
    mockRedisDatabase = {
      getClient: jest.fn().mockReturnValue(mockRedisClient),
      isConnectedToRedis: jest.fn().mockReturnValue(true),
      connectToRedis: jest.fn().mockResolvedValue(true)
    };

    // DatabaseManager のロード
    const originalDatabaseManager = require('../../../src/database/manager');
    databaseManager = {
      ...originalDatabaseManager,
      __getValidateRedisClientConnectionForTesting: jest.fn(() => originalDatabaseManager.__getValidateRedisClientConnectionForTesting())
    };
  });

  describe('代替接続指標の拡張テスト', () => {
    test('commandQueueが存在する場合、接続有効として認識される', async () => {
      const clientWithCommandQueue = {
        isReady: undefined,
        isOpen: undefined,
        status: undefined,
        commandQueue: [],
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      const result = await validateRedisClientConnection(clientWithCommandQueue, 'commandQueue接続チェック', mockLogger);
      
      // 代替接続指標で接続が有効と判定されることを確認
      expect(result.clientReady).toBe(true);
      expect(result.clientOpen).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/代替接続指標で接続有効を確認/)
      );
    });

    test('connectionオブジェクトのreadyStateが"open"の場合、接続有効として認識される', async () => {
      const clientWithConnection = {
        isReady: undefined,
        isOpen: undefined,
        status: undefined,
        connection: { readyState: 'open' },
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      const result = await validateRedisClientConnection(clientWithConnection, 'connection接続チェック', mockLogger);
      
      // 代替接続指標で接続が有効と判定されることを確認
      expect(result.clientReady).toBe(true);
      expect(result.clientOpen).toBe(true);
    });

    test('socketのreadable/writableがtrueの場合、接続有効として認識される', async () => {
      const clientWithSocket = {
        isReady: undefined,
        isOpen: undefined,
        status: undefined,
        socket: { readable: true, writable: true },
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      const result = await validateRedisClientConnection(clientWithSocket, 'socket接続チェック', mockLogger);
      
      // 代替接続指標で接続が有効と判定されることを確認
      expect(result.clientReady).toBe(true);
      expect(result.clientOpen).toBe(true);
    });
  });

  describe('明示的切断状態の検証テスト', () => {
    test('isReadyがfalseの場合、明示的切断状態として認識される', async () => {
      const explicitlyDisconnectedClient = {
        isReady: false,
        isOpen: undefined,
        status: undefined,
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      try {
        await validateRedisClientConnection(explicitlyDisconnectedClient, '明示的切断テスト', mockLogger);
      } catch (error) {
        // エラーが発生することが期待される
      }

      // 明示的切断状態の警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/明示的な切断状態を検出/)
      );
    });

    test('statusが"disconnected"の場合、明示的切断状態として認識される', async () => {
      const disconnectedClient = {
        isReady: undefined,
        isOpen: undefined,
        status: 'disconnected',
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      try {
        await validateRedisClientConnection(disconnectedClient, 'disconnected状態テスト', mockLogger);
      } catch (error) {
        // エラーが発生することが期待される
      }

      // 明示的切断状態の警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/明示的な切断状態を検出/)
      );
    });

    test('socketがreadable=false, writable=falseの場合、明示的切断状態として認識される', async () => {
      const socketDisconnectedClient = {
        isReady: undefined,
        isOpen: undefined,
        status: undefined,
        socket: { readable: false, writable: false },
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      try {
        await validateRedisClientConnection(socketDisconnectedClient, 'socket切断テスト', mockLogger);
      } catch (error) {
        // エラーが発生することが期待される
      }

      // 明示的切断状態の警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/明示的な切断状態を検出/)
      );
    });
  });

  describe('PINGメソッド可用性チェックテスト', () => {
    test('pingメソッドが存在しない場合、適切にエラーハンドリングされる', async () => {
      const clientWithoutPing = {
        isReady: undefined,
        isOpen: undefined,
        status: undefined,
        // ping メソッドが存在しない
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      try {
        await validateRedisClientConnection(clientWithoutPing, 'ping不在テスト', mockLogger);
      } catch (error) {
        // エラーが発生することが期待される
      }

      // PINGメソッドが利用できない旨の警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/pingメソッドが利用できません/)
      );
    });

    test('pingメソッドがfunctionでない場合、適切にエラーハンドリングされる', async () => {
      const clientWithInvalidPing = {
        isReady: undefined,
        isOpen: undefined,
        status: undefined,
        ping: 'not_a_function',
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      try {
        await validateRedisClientConnection(clientWithInvalidPing, 'ping無効テスト', mockLogger);
      } catch (error) {
        // エラーが発生することが期待される
      }

      // PINGメソッドが利用できない旨の警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/pingメソッドが利用できません/)
      );
    });
  });

  describe('詳細診断情報の記録テスト', () => {
    test('接続診断情報が詳細にログ出力される', async () => {
      const diagnosticClient = {
        isReady: undefined,
        isOpen: undefined,
        status: 'connecting',
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      try {
        await validateRedisClientConnection(diagnosticClient, '診断情報テスト', mockLogger);
      } catch (error) {
        // エラーは期待される
      }

      // 詳細な診断情報がログ出力されることを確認
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/診断情報テスト: クライアント診断.*hasClient.*hasIsReadyProperty.*hasIsOpenProperty/)
      );
      
      // プロパティ未定義またはundefined値検出の警告ログが出力されることを確認
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/診断情報テスト: プロパティ未定義またはundefined値検出/)
      );
    });
  });

  describe('Issue #5732のログ形式整合性テスト', () => {
    test('ready=undefined, open=undefinedの形式でログが出力される', async () => {
      const undefinedClient = {
        isReady: undefined,
        isOpen: undefined,
        status: undefined,
        ping: jest.fn().mockResolvedValue('PONG'),
        constructor: { name: 'Redis' }
      };

      const validateRedisClientConnection = databaseManager.__getValidateRedisClientConnectionForTesting();
      
      try {
        await validateRedisClientConnection(undefinedClient, 'Issue5732形式テスト', mockLogger);
      } catch (error) {
        // エラーは期待される
      }

      // Issue #5732で報告された形式のログが出力されることを確認
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/ready=\(undefined value\), open=\(undefined value\)/)
      );
    });
  });
});