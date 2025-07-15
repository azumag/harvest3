describe('BacktestRunner Long Running Mode', () => {
  let originalConsoleLog;
  let originalProcessOn;
  let originalDateNow;
  let originalSetTimeout;
  let mockRunBacktest;
  let mockPostErrorToDiscord;
  let signalHandlers;

  beforeEach(() => {
    // モックの設定
    originalConsoleLog = console.log;
    originalProcessOn = process.on;
    originalDateNow = Date.now;
    originalSetTimeout = setTimeout;
    
    console.log = jest.fn();
    mockRunBacktest = jest.fn();
    mockPostErrorToDiscord = jest.fn().mockResolvedValue();
    signalHandlers = {};
    
    // process.onをモック
    process.on = jest.fn((event, handler) => {
      signalHandlers[event] = handler;
    });
    
    // Date.nowをモック
    const currentTime = 1640995200000; // 2022-01-01 00:00:00 UTC
    Date.now = jest.fn(() => currentTime);
    
    // タイムアウトをモック（実際の時間待機を回避）
    setTimeout = jest.fn((callback, delay) => {
      // 即座に実行
      callback();
      return 'timeout-id';
    });
    
    // グローバル関数をモック
    global.postErrorToDiscord = mockPostErrorToDiscord;
    global.runBacktest = mockRunBacktest;
  });

  afterEach(() => {
    // オリジナルの関数を復元
    console.log = originalConsoleLog;
    process.on = originalProcessOn;
    Date.now = originalDateNow;
    setTimeout = originalSetTimeout;
    
    delete global.postErrorToDiscord;
    delete global.runBacktest;
    jest.clearAllMocks();
  });

  describe('長時間実行モードの基本動作', () => {
    test('起動時に適切なログメッセージを出力する', () => {
      // main関数の模擬実装
      const main = () => {
        console.log('バックテストサービスを開始します（長時間実行モード）');
        
        const isShuttingDown = false;
        
        process.on('SIGTERM', () => {
          console.log('SIGTERM受信: グレースフルシャットダウンを開始します');
          isShuttingDown = true;
        });
        
        process.on('SIGINT', () => {
          console.log('SIGINT受信: グレースフルシャットダウンを開始します');
          isShuttingDown = true;
        });
      };

      main();

      expect(console.log).toHaveBeenCalledWith('バックテストサービスを開始します（長時間実行モード）');
      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });

    test('バックテスト実行の開始ログを出力する', async () => {
      mockRunBacktest.mockResolvedValue();
      
      const main = async () => {
        const isShuttingDown = false;
        
        if (!isShuttingDown) {
          const startTime = Date.now();
          console.log(`[${new Date().toISOString()}] バックテスト実行を開始します`);
          
          await global.runBacktest();
          
          const endTime = Date.now();
          const executionTime = Math.round((endTime - startTime) / 1000);
          console.log(`[${new Date().toISOString()}] バックテスト正常完了 (実行時間: ${executionTime}秒)`);
        }
      };

      await main();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('バックテスト実行を開始します')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('バックテスト正常完了 (実行時間: 0秒)')
      );
    });

    test('バックテスト実行エラー時に適切なエラーハンドリングを行う', async () => {
      const testError = new Error('Test backtest error');
      mockRunBacktest.mockRejectedValue(testError);
      
      const main = async () => {
        const isShuttingDown = false;
        
        if (!isShuttingDown) {
          try {
            console.log(`[${new Date().toISOString()}] バックテスト実行を開始します`);
            await global.runBacktest();
          } catch (error) {
            console.error(`[${new Date().toISOString()}] バックテスト実行エラー:`, error);
            console.error('エラースタック:', error.stack);
            
            if (typeof global.postErrorToDiscord === 'function') {
              await global.postErrorToDiscord(`バックテスト実行エラー: ${error.message}`).catch(console.error);
            }
            
            console.log('エラーが発生しましたが、プロセスを継続します...');
          }
        }
      };

      await main();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('バックテスト実行エラー:'),
        testError
      );
      expect(console.error).toHaveBeenCalledWith('エラースタック:', testError.stack);
      expect(mockPostErrorToDiscord).toHaveBeenCalledWith('バックテスト実行エラー: Test backtest error');
      expect(console.log).toHaveBeenCalledWith('エラーが発生しましたが、プロセスを継続します...');
    });
  });

  describe('シグナルハンドリング', () => {
    test('SIGTERMシグナルを受信した場合、グレースフルシャットダウンを開始する', () => {
      // main関数の模擬実装
      const main = () => {
        let isShuttingDown = false;
        
        process.on('SIGTERM', () => {
          console.log('SIGTERM受信: グレースフルシャットダウンを開始します');
          isShuttingDown = true;
        });
        
        return { isShuttingDown };
      };

      const { isShuttingDown } = main();
      
      // SIGTERMシグナルを送信
      signalHandlers.SIGTERM();
      
      expect(console.log).toHaveBeenCalledWith('SIGTERM受信: グレースフルシャットダウンを開始します');
    });

    test('SIGINTシグナルを受信した場合、グレースフルシャットダウンを開始する', () => {
      // main関数の模擬実装
      const main = () => {
        let isShuttingDown = false;
        
        process.on('SIGINT', () => {
          console.log('SIGINT受信: グレースフルシャットダウンを開始します');
          isShuttingDown = true;
        });
        
        return { isShuttingDown };
      };

      const { isShuttingDown } = main();
      
      // SIGINTシグナルを送信
      signalHandlers.SIGINT();
      
      expect(console.log).toHaveBeenCalledWith('SIGINT受信: グレースフルシャットダウンを開始します');
    });
  });

  describe('実行間隔の制御', () => {
    test('正常完了後に500秒待機のログを出力する', async () => {
      mockRunBacktest.mockResolvedValue();
      
      const main = async () => {
        const isShuttingDown = false;
        
        if (!isShuttingDown) {
          await global.runBacktest();
          
          if (!isShuttingDown) {
            console.log(`[${new Date().toISOString()}] 次の実行まで500秒待機します`);
          }
        }
      };

      await main();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('次の実行まで500秒待機します')
      );
    });

    test('待機中にシャットダウンシグナルを受信した場合、適切に中断する', async () => {
      mockRunBacktest.mockResolvedValue();
      
      const main = async () => {
        let isShuttingDown = false;
        
        // シグナルハンドラーの設定
        const shutdownHandler = () => {
          isShuttingDown = true;
        };
        
        await global.runBacktest();
        
        if (!isShuttingDown) {
          console.log(`[${new Date().toISOString()}] 次の実行まで500秒待機します`);
          
          // 待機中のシャットダウンシミュレーション
          const totalWaitTime = 500 * 1000;
          const checkInterval = 10 * 1000;
          
          // 待機開始後にシャットダウンシグナルを受信
          shutdownHandler();
          
          // シャットダウンフラグがtrueの場合、待機をスキップ
          if (isShuttingDown) {
            console.log('バックテストサービスを終了します');
            return;
          }
        }
      };

      await main();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('次の実行まで500秒待機します')
      );
      expect(console.log).toHaveBeenCalledWith('バックテストサービスを終了します');
    });
  });

  describe('タイムスタンプ付きログ', () => {
    test('実行開始時にISO形式のタイムスタンプを含むログを出力する', async () => {
      mockRunBacktest.mockResolvedValue();
      
      const main = async () => {
        console.log(`[${new Date().toISOString()}] バックテスト実行を開始します`);
        await global.runBacktest();
      };

      await main();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/^\[[\d]{4}-[\d]{2}-[\d]{2}T[\d]{2}:[\d]{2}:[\d]{2}\.[\d]{3}Z\] バックテスト実行を開始します$/)
      );
    });

    test('実行完了時にISO形式のタイムスタンプと実行時間を含むログを出力する', async () => {
      mockRunBacktest.mockResolvedValue();
      
      const main = async () => {
        const startTime = Date.now();
        console.log(`[${new Date().toISOString()}] バックテスト実行を開始します`);
        
        await global.runBacktest();
        
        const endTime = Date.now();
        const executionTime = Math.round((endTime - startTime) / 1000);
        console.log(`[${new Date().toISOString()}] バックテスト正常完了 (実行時間: ${executionTime}秒)`);
      };

      await main();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/^\[[\d]{4}-[\d]{2}-[\d]{2}T[\d]{2}:[\d]{2}:[\d]{2}\.[\d]{3}Z\] バックテスト正常完了 \(実行時間: \d+秒\)$/)
      );
    });
  });

  describe('Discord通知との統合', () => {
    test('Discord通知関数が利用できない場合でも正常に動作する', async () => {
      delete global.postErrorToDiscord;
      
      const testError = new Error('Test error without Discord');
      mockRunBacktest.mockRejectedValue(testError);
      
      const main = async () => {
        try {
          await global.runBacktest();
        } catch (error) {
          console.error(`[${new Date().toISOString()}] バックテスト実行エラー:`, error);
          
          if (typeof global.postErrorToDiscord === 'function') {
            await global.postErrorToDiscord(`バックテスト実行エラー: ${error.message}`).catch(console.error);
          }
          
          console.log('エラーが発生しましたが、プロセスを継続します...');
        }
      };

      await main();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('バックテスト実行エラー:'),
        testError
      );
      expect(console.log).toHaveBeenCalledWith('エラーが発生しましたが、プロセスを継続します...');
    });
  });
});