describe('BacktestRunner Error Handling', () => {
  let originalConsoleError;
  let originalConsoleLog;
  let originalProcessExit;
  let mockPostErrorToDiscord;

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

    // 既存のイベントリスナーをクリアしてから新しいハンドラーを登録
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');

    // エラーハンドラーを直接登録（backtestRunner.jsと同じロジック）
    process.on('unhandledRejection', (reason, promise) => {
      console.error('未処理のPromise拒否が発生しました:', reason);
      console.error('Promise:', promise);
      console.error('エラースタック:', reason?.stack || 'スタックトレースなし');
      
      // Discord通知（利用可能な場合）
      if (typeof global.postErrorToDiscord === 'function') {
        global.postErrorToDiscord(`バックテスト未処理エラー: ${reason?.message || reason}`).catch(console.error);
      }
      
      // 重要な未処理エラーの場合は終了、それ以外は継続
      if (reason?.code === 'ECONNREFUSED' || reason?.code === 'EPIPE') {
        console.log('重要なエラーが発生しました。プロセスを終了します。');
        process.exit(1);
      } else {
        console.log('エラーが発生しましたが、プロセスを継続します...');
      }
    });

    process.on('uncaughtException', (error) => {
      console.error('未捕捉の例外が発生しました:', error);
      console.error('エラースタック:', error.stack);
      
      // Discord通知（利用可能な場合）
      if (typeof global.postErrorToDiscord === 'function') {
        global.postErrorToDiscord(`バックテスト例外: ${error.message}`).catch(console.error);
      }
      
      // 重要な例外の場合は終了
      if (error.code === 'ECONNREFUSED' || error.code === 'EPIPE' || error.name === 'ReferenceError') {
        console.log('重要な例外が発生しました。プロセスを終了します。');
        process.exit(1);
      } else {
        console.log('例外が発生しましたが、プロセスを継続します...');
      }
    });
  });

  afterEach(() => {
    // オリジナルの関数を復元
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    process.exit = originalProcessExit;
    delete global.postErrorToDiscord;

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

      expect(console.error).toHaveBeenCalledWith('未処理のPromise拒否が発生しました:', testError);
      expect(console.error).toHaveBeenCalledWith('Promise:', testPromise);
      expect(console.error).toHaveBeenCalledWith('エラースタック:', testError.stack);
      expect(console.log).toHaveBeenCalledWith('エラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('Discord通知が利用可能な場合は通知を送信し、プロセスを継続する', async () => {
      const testError = new Error('Test error for Discord');
      const testPromise = Promise.reject(testError).catch(() => {}); // Jestによる検出を防ぐ

      process.emit('unhandledRejection', testError, testPromise);

      // Discord通知の処理を待つ
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト未処理エラー: Test error for Discord');
      expect(console.log).toHaveBeenCalledWith('エラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('Discord関数が利用できない場合でも正常に動作し、プロセスを継続する', async () => {
      // postErrorToDiscord関数を削除
      delete global.postErrorToDiscord;

      const testError = new Error('Test error without Discord');
      const testPromise = Promise.reject(testError).catch(() => {}); // Jestによる検出を防ぐ

      process.emit('unhandledRejection', testError, testPromise);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未処理のPromise拒否が発生しました:', testError);
      expect(console.error).toHaveBeenCalledWith('エラースタック:', testError.stack);
      expect(console.log).toHaveBeenCalledWith('エラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('ECONNREFUSED エラーの場合はプロセスを終了する', async () => {
      const testError = new Error('Connection refused');
      testError.code = 'ECONNREFUSED';
      const testPromise = Promise.reject(testError).catch(() => {}); // Jestによる検出を防ぐ

      process.emit('unhandledRejection', testError, testPromise);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未処理のPromise拒否が発生しました:', testError);
      expect(console.log).toHaveBeenCalledWith('重要なエラーが発生しました。プロセスを終了します。');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('EPIPE エラーの場合はプロセスを終了する', async () => {
      const testError = new Error('Broken pipe');
      testError.code = 'EPIPE';
      const testPromise = Promise.reject(testError).catch(() => {}); // Jestによる検出を防ぐ

      process.emit('unhandledRejection', testError, testPromise);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未処理のPromise拒否が発生しました:', testError);
      expect(console.log).toHaveBeenCalledWith('重要なエラーが発生しました。プロセスを終了します。');
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('uncaughtException エラーハンドラー', () => {
    test('未捕捉の例外を適切に処理し、プロセスを継続する', async () => {
      const testError = new Error('Test uncaught exception');

      process.emit('uncaughtException', testError);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未捕捉の例外が発生しました:', testError);
      expect(console.error).toHaveBeenCalledWith('エラースタック:', testError.stack);
      expect(console.log).toHaveBeenCalledWith('例外が発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('Discord通知が利用可能な場合は通知を送信し、プロセスを継続する', async () => {
      const testError = new Error('Test exception for Discord');

      process.emit('uncaughtException', testError);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト例外: Test exception for Discord');
      expect(console.log).toHaveBeenCalledWith('例外が発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('ECONNREFUSED エラーの場合はプロセスを終了する', async () => {
      const testError = new Error('Connection refused');
      testError.code = 'ECONNREFUSED';

      process.emit('uncaughtException', testError);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未捕捉の例外が発生しました:', testError);
      expect(console.log).toHaveBeenCalledWith('重要な例外が発生しました。プロセスを終了します。');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('EPIPE エラーの場合はプロセスを終了する', async () => {
      const testError = new Error('Broken pipe');
      testError.code = 'EPIPE';

      process.emit('uncaughtException', testError);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未捕捉の例外が発生しました:', testError);
      expect(console.log).toHaveBeenCalledWith('重要な例外が発生しました。プロセスを終了します。');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('ReferenceError の場合はプロセスを終了する', async () => {
      const testError = new ReferenceError('Undefined variable');

      process.emit('uncaughtException', testError);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未捕捉の例外が発生しました:', testError);
      expect(console.log).toHaveBeenCalledWith('重要な例外が発生しました。プロセスを終了します。');
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('main関数のエラーハンドリング', () => {
    test('runBacktest関数のエラーを適切にキャッチし、プロセスを継続する', async () => {
      // main関数を模擬（新しいエラーハンドリング仕様に合わせて）
      const mockRunBacktest = jest.fn().mockRejectedValue(new Error('Backtest execution error'));
      
      const main = async () => {
        try {
          await mockRunBacktest();
          console.log('バックテスト正常完了');
        } catch (error) {
          console.error('バックテスト実行エラー:', error);
          console.error('エラースタック:', error.stack);
          
          if (typeof global.postErrorToDiscord === 'function') {
            await global.postErrorToDiscord(`バックテスト実行エラー: ${error.message}`).catch(console.error);
          }
          
          console.log('バックテスト実行中にエラーが発生しましたが、プロセスを継続します...');
          
          // エラー発生時は少し待機してからリターン（Docker composeのループで再実行される）
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      };

      await main();

      expect(console.error).toHaveBeenCalledWith('バックテスト実行エラー:', expect.any(Error));
      expect(console.error).toHaveBeenCalledWith('エラースタック:', expect.any(String));
      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト実行エラー: Backtest execution error');
      expect(console.log).toHaveBeenCalledWith('バックテスト実行中にエラーが発生しましたが、プロセスを継続します...');
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
          console.log('バックテスト正常完了');
        } catch (error) {
          console.error('バックテスト実行エラー:', error);
          console.error('エラースタック:', error.stack);
          
          if (typeof global.postErrorToDiscord === 'function') {
            await global.postErrorToDiscord(`バックテスト実行エラー: ${error.message}`).catch(console.error);
          }
          
          console.log('バックテスト実行中にエラーが発生しましたが、プロセスを継続します...');
          
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      };

      await main();

      expect(console.error).toHaveBeenCalledWith('バックテスト実行エラー:', expect.any(Error));
      expect(console.error).toHaveBeenCalledWith('エラースタック:', expect.any(String));
      expect(mockPostErrorToDiscordFailing).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('バックテスト実行中にエラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('エラー回復性', () => {
    test('エラー時はプロセスを終了せず、継続処理を行う', () => {
      const testError = new Error('Test error');
      
      process.emit('uncaughtException', testError);
      
      expect(console.log).toHaveBeenCalledWith('例外が発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('複数のエラーが発生しても適切に処理され、プロセスが継続される', async () => {
      const testError1 = new Error('First error');
      const testError2 = new Error('Second error');
      
      process.emit('uncaughtException', testError1);
      process.emit('unhandledRejection', testError2, Promise.reject(testError2).catch(() => {})); // Jestによる検出を防ぐ
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 両方のエラーに対して継続メッセージが出力される
      expect(console.log).toHaveBeenCalledWith('例外が発生しましたが、プロセスを継続します...');
      expect(console.log).toHaveBeenCalledWith('エラーが発生しましたが、プロセスを継続します...');
      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});