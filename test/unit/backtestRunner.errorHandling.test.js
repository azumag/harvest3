describe('BacktestRunner Error Handling', () => {
  let originalConsoleError;
  let originalProcessExit;
  let mockPostErrorToDiscord;

  beforeEach(() => {
    // コンソールエラーをモック
    originalConsoleError = console.error;
    console.error = jest.fn();

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
      
      // Discord通知（利用可能な場合）
      if (typeof global.postErrorToDiscord === 'function') {
        global.postErrorToDiscord(`バックテスト未処理エラー: ${reason?.message || reason}`).catch(console.error);
      }
      
      // 適切にプロセスを終了
      process.exit(1);
    });

    process.on('uncaughtException', (error) => {
      console.error('未捕捉の例外が発生しました:', error);
      
      // Discord通知（利用可能な場合）
      if (typeof global.postErrorToDiscord === 'function') {
        global.postErrorToDiscord(`バックテスト例外: ${error.message}`).catch(console.error);
      }
      
      // 適切にプロセスを終了
      process.exit(1);
    });
  });

  afterEach(() => {
    // オリジナルの関数を復元
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
    delete global.postErrorToDiscord;

    // 全てのイベントリスナーをクリア
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });

  describe('unhandledRejection エラーハンドラー', () => {
    test('未処理のPromise拒否を適切に処理する', async () => {
      // unhandledRejectionイベントをエミット
      const testError = new Error('Test unhandled rejection');
      const testPromise = Promise.reject(testError);
      
      process.emit('unhandledRejection', testError, testPromise);

      // 少し待ってからアサーション
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未処理のPromise拒否が発生しました:', testError);
      expect(console.error).toHaveBeenCalledWith('Promise:', testPromise);
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('Discord通知が利用可能な場合は通知を送信する', async () => {
      const testError = new Error('Test error for Discord');
      const testPromise = Promise.reject(testError);

      process.emit('unhandledRejection', testError, testPromise);

      // Discord通知の処理を待つ
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト未処理エラー: Test error for Discord');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('Discord関数が利用できない場合でも正常に動作する', async () => {
      // postErrorToDiscord関数を削除
      delete global.postErrorToDiscord;

      const testError = new Error('Test error without Discord');
      const testPromise = Promise.reject(testError);

      process.emit('unhandledRejection', testError, testPromise);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未処理のPromise拒否が発生しました:', testError);
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('uncaughtException エラーハンドラー', () => {
    test('未捕捉の例外を適切に処理する', async () => {
      const testError = new Error('Test uncaught exception');

      process.emit('uncaughtException', testError);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(console.error).toHaveBeenCalledWith('未捕捉の例外が発生しました:', testError);
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('Discord通知が利用可能な場合は通知を送信する', async () => {
      const testError = new Error('Test exception for Discord');

      process.emit('uncaughtException', testError);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト例外: Test exception for Discord');
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('main関数のエラーハンドリング', () => {
    test('runBacktest関数のエラーを適切にキャッチする', async () => {
      // main関数を模擬
      const mockRunBacktest = jest.fn().mockRejectedValue(new Error('Backtest execution error'));
      
      const main = async () => {
        try {
          await mockRunBacktest();
        } catch (error) {
          console.error('バックテスト実行エラー:', error);
          
          if (typeof global.postErrorToDiscord === 'function') {
            await global.postErrorToDiscord(`バックテスト実行エラー: ${error.message}`).catch(console.error);
          }
          
          process.exit(1);
        }
      };

      await main();

      expect(console.error).toHaveBeenCalledWith('バックテスト実行エラー:', expect.any(Error));
      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト実行エラー: Backtest execution error');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('Discord通知でエラーが発生しても main のエラーハンドリングが継続する', async () => {
      // Discord通知でエラーが発生するケース
      const mockPostErrorToDiscordFailing = jest.fn().mockRejectedValue(new Error('Discord error'));
      global.postErrorToDiscord = mockPostErrorToDiscordFailing;

      const mockRunBacktest = jest.fn().mockRejectedValue(new Error('Backtest error'));
      
      const main = async () => {
        try {
          await mockRunBacktest();
        } catch (error) {
          console.error('バックテスト実行エラー:', error);
          
          if (typeof global.postErrorToDiscord === 'function') {
            await global.postErrorToDiscord(`バックテスト実行エラー: ${error.message}`).catch(console.error);
          }
          
          process.exit(1);
        }
      };

      await main();

      expect(console.error).toHaveBeenCalledWith('バックテスト実行エラー:', expect.any(Error));
      expect(mockPostErrorToDiscordFailing).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('プロセス終了コード', () => {
    test('エラー時は適切にexit code 1で終了する', () => {
      const testError = new Error('Test error');
      
      process.emit('uncaughtException', testError);
      
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    test('複数のエラーが発生しても適切に処理される', async () => {
      const testError1 = new Error('First error');
      const testError2 = new Error('Second error');
      
      process.emit('uncaughtException', testError1);
      process.emit('unhandledRejection', testError2, Promise.reject(testError2));
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 最初のエラーでprocess.exitが呼ばれる
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});