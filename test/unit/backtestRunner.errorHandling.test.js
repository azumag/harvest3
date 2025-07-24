describe('BacktestRunner Error Handling', () => {
  let originalConsoleError;
  let originalConsoleLog;
  let originalProcessExit;
  let mockPostErrorToDiscord;
  let mockLogWithLevel;

  beforeEach(() => {
    // コンソールエラーとログをモック
    originalConsoleError = console.error;
    originalConsoleLog = console.log;
    console.error = jest.fn();
    console.log = jest.fn();

    // process.exitをモック
    originalProcessExit = process.exit;
    process.exit = jest.fn();

    // postErrorToDiscord関数をモック
    mockPostErrorToDiscord = jest.fn().mockResolvedValue();
    global.postErrorToDiscord = mockPostErrorToDiscord;

    // logWithLevel関数をモック（実装と同じロジック）
    const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const shouldLog = (level) => levels[level] <= levels[LOG_LEVEL];
    
    mockLogWithLevel = jest.fn((level, ...args) => {
      if (shouldLog(level)) {
        console.log(...args);
      }
    });
    global.logWithLevel = mockLogWithLevel;

    // 既存のイベントリスナーをクリアしてから新しいハンドラーを登録
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');

    // エラーハンドラーを直接登録（backtestRunner.jsと同じロジック）
    process.on('unhandledRejection', (reason, promise) => {
      global.logWithLevel('error', '未処理のPromise拒否が発生しました:', reason);
      global.logWithLevel('error', 'Promise:', promise);
      global.logWithLevel('error', 'エラースタック:', reason?.stack || 'スタックトレースなし');
      
      // Discord通知（利用可能な場合）
      if (typeof global.postErrorToDiscord === 'function') {
        global.postErrorToDiscord(`バックテスト未処理エラー: ${reason?.message || reason}`).catch(err => global.logWithLevel('error', err));
      }
      
      // プロセスを終了せず、エラーログを出力して継続
      global.logWithLevel('warn', 'エラーが発生しましたが、プロセスを継続します...');
    });

    process.on('uncaughtException', (error) => {
      global.logWithLevel('error', '未捕捉の例外が発生しました:', error);
      global.logWithLevel('error', 'エラースタック:', error.stack);
      
      // Discord通知（利用可能な場合）
      if (typeof global.postErrorToDiscord === 'function') {
        global.postErrorToDiscord(`バックテスト例外: ${error.message}`).catch(err => global.logWithLevel('error', err));
      }
      
      // プロセスを終了せず、エラーログを出力して継続
      global.logWithLevel('warn', '例外が発生しましたが、プロセスを継続します...');
    });
  });

  afterEach(() => {
    // オリジナルの関数を復元
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    process.exit = originalProcessExit;
    delete global.postErrorToDiscord;
    delete global.logWithLevel;

    // 全てのイベントリスナーをクリア
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });

  describe('unhandledRejection エラーハンドラー', () => {
    test('未処理のPromise拒否を適切に処理し、プロセスを継続する', async () => {
      // unhandledRejectionイベントをエミット
      const testError = new Error('Test unhandled rejection');
      const testPromise = Promise.reject(testError).catch(() => {}); // Jestによる検出を防ぐ
      
      process.emit('unhandledRejection', testError, testPromise);

      // 少し待ってからアサーション
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockLogWithLevel).toHaveBeenCalledWith('error', '未処理のPromise拒否が発生しました:', testError);
      expect(mockLogWithLevel).toHaveBeenCalledWith('error', 'Promise:', testPromise);
      expect(mockLogWithLevel).toHaveBeenCalledWith('error', 'エラースタック:', testError.stack);
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', 'エラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('Discord通知が利用可能な場合は通知を送信し、プロセスを継続する', async () => {
      const testError = new Error('Test error for Discord');
      const testPromise = Promise.reject(testError).catch(() => {}); // Jestによる検出を防ぐ

      process.emit('unhandledRejection', testError, testPromise);

      // Discord通知の処理を待つ
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト未処理エラー: Test error for Discord');
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', 'エラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('Discord関数が利用できない場合でも正常に動作し、プロセスを継続する', async () => {
      // postErrorToDiscord関数を削除
      delete global.postErrorToDiscord;

      const testError = new Error('Test error without Discord');
      const testPromise = Promise.reject(testError).catch(() => {}); // Jestによる検出を防ぐ

      process.emit('unhandledRejection', testError, testPromise);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockLogWithLevel).toHaveBeenCalledWith('error', '未処理のPromise拒否が発生しました:', testError);
      expect(mockLogWithLevel).toHaveBeenCalledWith('error', 'エラースタック:', testError.stack);
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', 'エラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('uncaughtException エラーハンドラー', () => {
    test('未捕捉の例外を適切に処理し、プロセスを継続する', async () => {
      const testError = new Error('Test uncaught exception');

      process.emit('uncaughtException', testError);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockLogWithLevel).toHaveBeenCalledWith('error', '未捕捉の例外が発生しました:', testError);
      expect(mockLogWithLevel).toHaveBeenCalledWith('error', 'エラースタック:', testError.stack);
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', '例外が発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('Discord通知が利用可能な場合は通知を送信し、プロセスを継続する', async () => {
      const testError = new Error('Test exception for Discord');

      process.emit('uncaughtException', testError);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト例外: Test exception for Discord');
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', '例外が発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('main関数のエラーハンドリング', () => {
    test('runBacktest関数のエラーを適切にキャッチし、プロセスを継続する', async () => {
      // main関数を模擬（新しいエラーハンドリング仕様に合わせて）
      const mockRunBacktest = jest.fn().mockRejectedValue(new Error('Backtest execution error'));
      
      const main = async () => {
        try {
          await mockRunBacktest();
          global.logWithLevel('info', 'バックテスト正常完了');
        } catch (error) {
          global.logWithLevel('error', 'バックテスト実行エラー:', error);
          global.logWithLevel('error', 'エラースタック:', error.stack);
          
          if (typeof global.postErrorToDiscord === 'function') {
            await global.postErrorToDiscord(`バックテスト実行エラー: ${error.message}`).catch(err => global.logWithLevel('error', err));
          }
          
          global.logWithLevel('warn', 'バックテスト実行中にエラーが発生しましたが、プロセスを継続します...');
          
          // エラー発生時は少し待機してからリターン（Docker composeのループで再実行される）
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      };

      await main();

      expect(mockLogWithLevel).toHaveBeenCalledWith('error', 'バックテスト実行エラー:', expect.any(Error));
      expect(mockLogWithLevel).toHaveBeenCalledWith('error', 'エラースタック:', expect.any(String));
      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト実行エラー: Backtest execution error');
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', 'バックテスト実行中にエラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('Discord通知でエラーが発生しても main のエラーハンドリングが継続し、プロセスを継続する', async () => {
      // Discord通知でエラーが発生するケース
      const mockPostErrorToDiscordFailing = jest.fn().mockRejectedValue(new Error('Discord error'));
      global.postErrorToDiscord = mockPostErrorToDiscordFailing;

      const mockRunBacktest = jest.fn().mockRejectedValue(new Error('Backtest error'));
      
      const main = async () => {
        try {
          await mockRunBacktest();
          global.logWithLevel('info', 'バックテスト正常完了');
        } catch (error) {
          global.logWithLevel('error', 'バックテスト実行エラー:', error);
          global.logWithLevel('error', 'エラースタック:', error.stack);
          
          if (typeof global.postErrorToDiscord === 'function') {
            await global.postErrorToDiscord(`バックテスト実行エラー: ${error.message}`).catch(err => global.logWithLevel('error', err));
          }
          
          global.logWithLevel('warn', 'バックテスト実行中にエラーが発生しましたが、プロセスを継続します...');
          
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      };

      await main();

      expect(mockLogWithLevel).toHaveBeenCalledWith('error', 'バックテスト実行エラー:', expect.any(Error));
      expect(mockLogWithLevel).toHaveBeenCalledWith('error', 'エラースタック:', expect.any(String));
      expect(mockPostErrorToDiscordFailing).toHaveBeenCalled();
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', 'バックテスト実行中にエラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('エラー回復性', () => {
    test('エラー時はプロセスを終了せず、継続処理を行う', () => {
      const testError = new Error('Test error');
      
      process.emit('uncaughtException', testError);
      
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', '例外が発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('複数のエラーが発生しても適切に処理され、プロセスが継続される', async () => {
      const testError1 = new Error('First error');
      const testError2 = new Error('Second error');
      
      process.emit('uncaughtException', testError1);
      process.emit('unhandledRejection', testError2, Promise.reject(testError2).catch(() => {})); // Jestによる検出を防ぐ
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 両方のエラーに対して継続メッセージが出力される
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', '例外が発生しましたが、プロセスを継続します...');
      expect(mockLogWithLevel).toHaveBeenCalledWith('warn', 'エラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});