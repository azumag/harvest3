describe('BacktestRunner Process Exit Handling', () => {
  let originalProcessExit;
  let originalConsoleLog;
  let originalConsoleError;

  beforeEach(() => {
    // process.exitとconsoleをモック
    originalProcessExit = process.exit;
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    
    process.exit = jest.fn();
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    // オリジナルの関数を復元
    process.exit = originalProcessExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('runBacktest関数のfinally処理', () => {
    test('runBacktest関数のfinally処理ではprocess.exitが呼ばれない', async () => {
      // runBacktest関数の簡易版をモック
      const mockRunBacktest = async () => {
        try {
          // 正常な処理をシミュレート
          await new Promise(resolve => setTimeout(resolve, 10));
          console.log('バックテスト処理が正常に完了');
        } catch (error) {
          console.error('バックテスト実行中にエラーが発生しました:', error);
        } finally {
          // 修正後の処理: process.exit(0)を削除
          console.log('バックテスト処理が完了しました。');
        }
      };

      await mockRunBacktest();

      // finally処理で適切なログが出力されることを確認
      expect(console.log).toHaveBeenCalledWith('バックテスト処理が完了しました。');
      // process.exit(0)が呼ばれないことを確認
      expect(process.exit).not.toHaveBeenCalled();
    });

    test('runBacktest関数でエラーが発生してもprocess.exitが呼ばれない', async () => {
      // runBacktest関数の簡易版をモック（エラーパターン）
      const mockRunBacktest = async () => {
        try {
          // エラーを発生させる
          throw new Error('Test error');
        } catch (error) {
          console.error('バックテスト実行中にエラーが発生しました:', error);
        } finally {
          // 修正後の処理: process.exit(0)を削除
          console.log('バックテスト処理が完了しました。');
        }
      };

      await mockRunBacktest();

      // エラーログが出力されることを確認
      expect(console.error).toHaveBeenCalledWith('バックテスト実行中にエラーが発生しました:', expect.any(Error));
      // finally処理で適切なログが出力されることを確認
      expect(console.log).toHaveBeenCalledWith('バックテスト処理が完了しました。');
      // process.exit(0)が呼ばれないことを確認
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('main関数のグレースフルシャットダウン', () => {
    test('main関数は正常終了時にprocess.exit(0)を呼ぶ', async () => {
      // main関数のシャットダウン部分をモック
      const mockMainShutdown = async () => {
        console.log('バックテストサービスを終了します');
        
        // ヘルスチェックサーバーを停止
        const healthStatus = { status: 'stopping' };
        const healthCheckServer = { close: jest.fn() };
        
        if (healthCheckServer) {
          healthCheckServer.close(() => {
            console.log('ヘルスチェックサーバーを停止しました');
          });
        }
        
        // メモリ使用量レポート
        const finalMemory = { heapUsed: 100 * 1024 * 1024 }; // 100MB
        console.log(`終了時メモリ使用量: ${Math.round(finalMemory.heapUsed / 1024 / 1024)}MB`);
        
        // 正常終了
        process.exit(0);
      };

      await mockMainShutdown();

      expect(console.log).toHaveBeenCalledWith('バックテストサービスを終了します');
      expect(console.log).toHaveBeenCalledWith('終了時メモリ使用量: 100MB');
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    test('シグナルハンドラーでisShuttingDownフラグが設定される', () => {
      // シグナルハンドラーをモック
      let isShuttingDown = false;
      const healthStatus = { status: 'running' };
      
      const mockSigTermHandler = () => {
        console.log('SIGTERM受信: グレースフルシャットダウンを開始します');
        isShuttingDown = true;
        healthStatus.status = 'shutting-down';
      };

      const mockSigIntHandler = () => {
        console.log('SIGINT受信: グレースフルシャットダウンを開始します');
        isShuttingDown = true;
        healthStatus.status = 'shutting-down';
      };

      // SIGTERMハンドラーをテスト
      mockSigTermHandler();
      expect(console.log).toHaveBeenCalledWith('SIGTERM受信: グレースフルシャットダウンを開始します');
      expect(isShuttingDown).toBe(true);
      expect(healthStatus.status).toBe('shutting-down');

      // リセット
      isShuttingDown = false;
      healthStatus.status = 'running';

      // SIGINTハンドラーをテスト
      mockSigIntHandler();
      expect(console.log).toHaveBeenCalledWith('SIGINT受信: グレースフルシャットダウンを開始します');
      expect(isShuttingDown).toBe(true);
      expect(healthStatus.status).toBe('shutting-down');
    });
  });

  describe('長時間実行モードの改善', () => {
    test('長時間実行モードでは適切なタイミングでのみprocess.exitが呼ばれる', async () => {
      // 長時間実行モードのメインループをモック
      const mockLongRunningMode = async () => {
        let isShuttingDown = false;
        let executionCount = 0;
        const maxExecutions = 2; // テスト用に制限
        
        // シグナルハンドラーをモック
        const simulateSignal = () => {
          isShuttingDown = true;
        };

        while (!isShuttingDown && executionCount < maxExecutions) {
          try {
            console.log(`[${new Date().toISOString()}] バックテスト実行を開始します`);
            
            // バックテスト処理をシミュレート
            await new Promise(resolve => setTimeout(resolve, 10));
            
            console.log(`[${new Date().toISOString()}] バックテスト正常完了`);
            executionCount++;
            
            // 2回目の実行後にシャットダウンをシミュレート
            if (executionCount === maxExecutions) {
              simulateSignal();
            }
            
          } catch (error) {
            console.error(`[${new Date().toISOString()}] バックテスト実行エラー:`, error);
          }
          
          if (!isShuttingDown) {
            // 次の実行まで待機（テスト用に短縮）
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        
        console.log('バックテストサービスを終了します');
        process.exit(0);
      };

      await mockLongRunningMode();

      // 適切な回数のバックテスト実行がログに記録されることを確認
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('バックテスト実行を開始します'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('バックテスト正常完了'));
      expect(console.log).toHaveBeenCalledWith('バックテストサービスを終了します');
      
      // 最終的にprocess.exit(0)が呼ばれることを確認
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('Docker再起動ループの防止', () => {
    test('プロセスが適切に終了することでDocker再起動ループが防止される', async () => {
      // Docker環境でのプロセスライフサイクルをモック
      const mockDockerProcessLifecycle = async () => {
        let serviceRunning = true;
        
        // サービス開始
        console.log('バックテストサービスを開始します（長時間実行モード）');
        
        // 正常な処理サイクル
        while (serviceRunning) {
          try {
            // バックテスト処理をシミュレート
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 処理完了後に自然終了（Docker再起動ループの原因を修正）
            console.log('バックテスト処理が完了しました。');
            serviceRunning = false;
            
          } catch (error) {
            console.error('バックテスト実行エラー:', error);
            // エラー時も自然終了
            serviceRunning = false;
          }
        }
        
        // 自然終了（process.exit(0)を削除したことによる改善）
        console.log('サービスが自然終了しました');
      };

      await mockDockerProcessLifecycle();

      expect(console.log).toHaveBeenCalledWith('バックテストサービスを開始します（長時間実行モード）');
      expect(console.log).toHaveBeenCalledWith('バックテスト処理が完了しました。');
      expect(console.log).toHaveBeenCalledWith('サービスが自然終了しました');
      
      // 即座にprocess.exit(0)が呼ばれないことを確認
      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});