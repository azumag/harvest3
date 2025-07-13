/**
 * APIコーディネーター単体テスト - Issue #443対応
 */

const { APICoordinator } = require('../../src/common/apiCoordinator');
const { EXCHANGE_SETTINGS } = require('../../src/common/const');

// テスト用のモック設定
jest.mock('../../src/common/const', () => ({
  EXCHANGE_SETTINGS: {
    RATE_LIMIT: 1000,
    MAX_THROTTLE_QUEUE_SIZE: 10,
    MAX_CONCURRENT_PAIRS: 2,
    THROTTLE_QUEUE_MONITORING: {
      ENABLED: false, // テスト中は無効化
      CHECK_INTERVAL: 1000,
      WARNING_THRESHOLD: 6,
      CRITICAL_THRESHOLD: 8,
      EMERGENCY_DELAY: 5000
    },
    CCXT_QUEUE_PROTECTION: {
      WAIT_TIME_BASE_MS: 2000,
      WAIT_TIME_MULTIPLIER_MS: 3000,
      WAIT_TIME_MAX_MS: 8000,
      EMERGENCY_REJECTION_RATE: 0.7
    }
  }
}));

jest.mock('../../src/common/throttleMonitor', () => ({
  throttleMonitor: {
    recordRequest: jest.fn()
  }
}));

jest.mock('../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

describe('APICoordinator', () => {
  let coordinator;

  beforeEach(() => {
    coordinator = new APICoordinator();
    jest.clearAllMocks();
  });

  afterEach(() => {
    coordinator.emergencyReset();
  });

  describe('executeAPICall', () => {
    test('正常なAPI呼び出しが成功すること', async () => {
      const mockAPICall = jest.fn().mockResolvedValue({ success: true });
      
      const result = await coordinator.executeAPICall(mockAPICall, 'test_request');
      
      expect(result).toEqual({ success: true });
      expect(mockAPICall).toHaveBeenCalledTimes(1);
    });

    test('API呼び出しエラーが適切に処理されること', async () => {
      const mockError = new Error('API Error');
      const mockAPICall = jest.fn().mockRejectedValue(mockError);
      
      await expect(coordinator.executeAPICall(mockAPICall, 'test_request'))
        .rejects.toThrow('API Error');
    });

    test('queue容量制限が機能すること', async () => {
      const mockAPICall = jest.fn().mockImplementation(() => new Promise(() => {})); // 永続化するPromise
      
      // 処理を停止してすべてのリクエストがキューに留まるようにする
      coordinator.isProcessing = true;
      
      // queue容量上限まで追加
      const promises = [];
      for (let i = 0; i < EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE; i++) {
        const promise = coordinator.executeAPICall(mockAPICall, `request_${i}`);
        // エラーハンドリングを追加して、emergencyResetによるキャンセルをキャッチ
        promise.catch(() => {}); // emergencyResetによるエラーを無視
        promises.push(promise);
      }
      
      // 容量を超えるリクエストは拒否されるべき（緊急排出後も高負荷の場合）
      await expect(coordinator.executeAPICall(mockAPICall, 'overflow_request'))
        .rejects.toThrow(/API coordinator queue (is full|remains critical after emergency drainage)/);
      
      // テスト終了前に手動でリセットして無限Promiseをクリーンアップ
      coordinator.emergencyReset();
    });

    test('優先度順でqueue処理されること', async () => {
      // 処理を一時停止するため、すべてのリクエストが処理されないようにする
      coordinator.isProcessing = true;
      
      const results = [];
      const mockAPICall = (id) => async () => {
        results.push(id);
        await new Promise(resolve => setTimeout(resolve, 50));
        return { id };
      };

      // 優先度を変えてリクエストを追加（数値が小さいほど高優先度）
      const promises = [];
      
      promises.push(coordinator.executeAPICall(mockAPICall('low'), 'low_priority', 3));
      promises.push(coordinator.executeAPICall(mockAPICall('high'), 'high_priority', 1));
      promises.push(coordinator.executeAPICall(mockAPICall('medium'), 'medium_priority', 2));

      // 少し待ってから処理開始
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 処理を再開
      coordinator.isProcessing = false;
      coordinator.processQueue();

      await Promise.all(promises);

      // 高優先度から順に処理されることを確認
      expect(results[0]).toBe('high');
      expect(results[1]).toBe('medium');
      expect(results[2]).toBe('low');
    });

    test('Rate limiting が機能すること', async () => {
      const startTime = Date.now();
      const mockAPICall = jest.fn().mockResolvedValue({ success: true });
      
      // 2つのリクエストを連続実行
      await coordinator.executeAPICall(mockAPICall, 'request1');
      await coordinator.executeAPICall(mockAPICall, 'request2');
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // RATE_LIMIT分の待機時間が発生していることを確認
      // タイミング精度の問題を考慮して、50ms程度の許容範囲を設ける
      expect(executionTime).toBeGreaterThanOrEqual(EXCHANGE_SETTINGS.RATE_LIMIT - 50);
    });

    test('並列実行数制限が機能すること', async () => {
      let concurrentCount = 0;
      let maxConcurrentCount = 0;
      
      const mockAPICall = jest.fn().mockImplementation(async () => {
        concurrentCount++;
        maxConcurrentCount = Math.max(maxConcurrentCount, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 200));
        concurrentCount--;
        return { success: true };
      });

      // 制限を超える数のリクエストを同時実行
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(coordinator.executeAPICall(mockAPICall, `request_${i}`));
      }

      await Promise.all(promises);

      // 最大並列数が制限内であることを確認
      expect(maxConcurrentCount).toBeLessThanOrEqual(EXCHANGE_SETTINGS.MAX_CONCURRENT_PAIRS);
    });
  });

  describe('getStats', () => {
    test('統計情報が正しく取得できること', async () => {
      const mockAPICall = jest.fn().mockResolvedValue({ success: true });
      
      await coordinator.executeAPICall(mockAPICall, 'test_request');
      
      const stats = coordinator.getStats();
      
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('queuedRequests');
      expect(stats).toHaveProperty('rejectedRequests');
      expect(stats).toHaveProperty('avgWaitTime');
      expect(stats).toHaveProperty('queueLength');
      expect(stats).toHaveProperty('activeRequests');
      expect(stats).toHaveProperty('queueUsageRate');
      
      expect(stats.totalRequests).toBe(1);
    });
  });

  describe('emergencyReset', () => {
    test('緊急リセットが機能すること', async () => {
      // 処理を停止してqueueに確実に残るようにする
      coordinator.isProcessing = true;
      
      const mockAPICall = jest.fn().mockImplementation(() => new Promise(() => {})); // 永続化するPromise
      
      // queueにリクエストを追加
      const promise = coordinator.executeAPICall(mockAPICall, 'test_request');
      
      // 短時間待ってからreset実行（queueに確実に追加されるように）
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // queueにリクエストが追加されていることを確認
      expect(coordinator.queue.length).toBe(1);
      
      // 緊急リセット実行
      coordinator.emergencyReset();
      
      // リクエストがキャンセルされることを確認
      await expect(promise).rejects.toThrow('Emergency reset - request cancelled');
      
      // queueがクリアされることを確認
      const stats = coordinator.getStats();
      expect(stats.queueLength).toBe(0);
      expect(stats.activeRequests).toBe(0);
    }, 10000); // タイムアウトを10秒に制限
  });

  describe('addToQueue', () => {
    test('優先度順でqueueに追加されること', () => {
      const request1 = { 
        id: 'req1', 
        priority: 3, 
        timestamp: Date.now(),
        resolve: jest.fn(),
        reject: jest.fn()
      };
      const request2 = { 
        id: 'req2', 
        priority: 1, 
        timestamp: Date.now(),
        resolve: jest.fn(),
        reject: jest.fn()
      };
      const request3 = { 
        id: 'req3', 
        priority: 2, 
        timestamp: Date.now(),
        resolve: jest.fn(),
        reject: jest.fn()
      };
      
      coordinator.addToQueue(request1);
      coordinator.addToQueue(request2);
      coordinator.addToQueue(request3);
      
      // 優先度順（昇順）で並んでいることを確認
      expect(coordinator.queue[0].id).toBe('req2'); // priority: 1
      expect(coordinator.queue[1].id).toBe('req3'); // priority: 2
      expect(coordinator.queue[2].id).toBe('req1'); // priority: 3
    });
  });

  describe('updateAverageWaitTime', () => {
    test('平均待機時間が正しく更新されること', () => {
      coordinator.stats.avgWaitTime = 1000;
      
      coordinator.updateAverageWaitTime(2000);
      
      // 移動平均による更新を確認（alpha = 0.1）
      const expected = 1000 * 0.9 + 2000 * 0.1;
      expect(coordinator.stats.avgWaitTime).toBe(expected);
    });
  });

  // Issue #447: 新機能のテスト
  describe('Issue #447: CCXT throttle queue overflow対策', () => {
    let mockThrottleMonitor;

    beforeEach(() => {
      // throttleMonitorのモック設定
      mockThrottleMonitor = {
        getStats: jest.fn().mockReturnValue({
          consecutiveErrors: 0,
          lastQueueOverflow: null
        })
      };
      
      // dynamically mock throttleMonitor for this test
      const { throttleMonitor } = require('../../src/common/throttleMonitor');
      Object.assign(throttleMonitor, mockThrottleMonitor);
    });

    describe('checkCcxtThrottleQueueBeforeExecution', () => {
      test('高負荷時に予防的待機が実行されること', async () => {
        // 高負荷状況をシミュレート（使用率45%）
        for (let i = 0; i < 5; i++) {
          coordinator.queue.push({ id: `dummy_${i}`, priority: 2 });
        }

        const request = { id: 'test_request' };
        const startTime = Date.now();

        await coordinator.checkCcxtThrottleQueueBeforeExecution(request);

        const executionTime = Date.now() - startTime;
        
        // 2秒以上の待機が発生していることを確認
        expect(executionTime).toBeGreaterThanOrEqual(1900); // 100ms余裕
      });

      test('連続エラー時に待機が実行されること', async () => {
        mockThrottleMonitor.getStats.mockReturnValue({
          consecutiveErrors: 3,
          lastQueueOverflow: null
        });

        const request = { id: 'test_request' };
        const startTime = Date.now();

        await coordinator.checkCcxtThrottleQueueBeforeExecution(request);

        const executionTime = Date.now() - startTime;
        
        // 5秒以上の待機が発生していることを確認
        expect(executionTime).toBeGreaterThanOrEqual(4900); // 100ms余裕
      });

      test('最近のmaxCapacityエラー時に長期待機が実行されること', async () => {
        mockThrottleMonitor.getStats.mockReturnValue({
          consecutiveErrors: 0,
          lastQueueOverflow: Date.now() - 20000 // 20秒前
        });

        const request = { id: 'test_request' };
        const startTime = Date.now();

        await coordinator.checkCcxtThrottleQueueBeforeExecution(request);

        const executionTime = Date.now() - startTime;
        
        // 10秒以上の待機が発生していることを確認
        expect(executionTime).toBeGreaterThanOrEqual(9900); // 100ms余裕
      });

      test('正常状況では待機が発生しないこと', async () => {
        // 正常状況（低負荷、エラーなし）
        coordinator.queue = []; // 空のキュー
        mockThrottleMonitor.getStats.mockReturnValue({
          consecutiveErrors: 0,
          lastQueueOverflow: null
        });

        const request = { id: 'test_request' };
        const startTime = Date.now();

        await coordinator.checkCcxtThrottleQueueBeforeExecution(request);

        const executionTime = Date.now() - startTime;
        
        // 待機時間が最小限であることを確認（50ms以下）
        expect(executionTime).toBeLessThan(50);
      });
    });

    describe('emergencyQueueClearance', () => {
      test('低優先度リクエストが適切に拒否されること', () => {
        // 様々な優先度のリクエストを作成
        const requests = [
          { id: 'high1', priority: 1, reject: jest.fn() },
          { id: 'medium1', priority: 2, reject: jest.fn() },
          { id: 'low1', priority: 3, reject: jest.fn() },
          { id: 'low2', priority: 3, dropIfBusy: true, reject: jest.fn() },
          { id: 'medium2', priority: 2, reject: jest.fn() }
        ];

        coordinator.queue = [...requests];

        coordinator.emergencyQueueClearance();

        // 低優先度リクエストが拒否されていることを確認
        expect(requests[2].reject).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Emergency queue clearance')
          })
        );
        expect(requests[3].reject).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Emergency queue clearance')
          })
        );

        // 優先度に基づいてリクエストが適切に処理されていることを確認
        const remainingIds = coordinator.queue.map(req => req.id);
        
        // 高優先度は必ず保持される
        expect(remainingIds).toContain('high1');
        
        // 低優先度とdropIfBusyは確実に拒否される
        expect(remainingIds).not.toContain('low1');
        expect(remainingIds).not.toContain('low2');
        
        // 70%削減により、5個中3個が拒否されるため、2個が保持される
        expect(remainingIds.length).toBe(2);
      });

      test('処理が一時停止され、後で再開されること', (done) => {
        coordinator.queue = [
          { id: 'test', priority: 2, reject: jest.fn() }
        ];

        const originalProcessQueue = coordinator.processQueue;
        coordinator.processQueue = jest.fn();

        coordinator.emergencyQueueClearance();

        // 処理が停止されていることを確認
        expect(coordinator.isProcessing).toBe(false);

        // 15秒後に処理が再開されることを確認
        setTimeout(() => {
          expect(coordinator.processQueue).toHaveBeenCalled();
          coordinator.processQueue = originalProcessQueue;
          done();
        }, 15100); // 15.1秒後にチェック
      }, 20000); // テストタイムアウトを20秒に設定

      test('統計が正しく更新されること', () => {
        const initialRejectedCount = coordinator.stats.rejectedRequests;
        
        coordinator.queue = [
          { id: 'high', priority: 1, reject: jest.fn() },
          { id: 'low1', priority: 3, reject: jest.fn() },
          { id: 'low2', priority: 3, reject: jest.fn() }
        ];

        coordinator.emergencyQueueClearance();

        // 拒否されたリクエスト数が統計に追加されていることを確認
        expect(coordinator.stats.rejectedRequests).toBeGreaterThan(initialRejectedCount);
      });
    });

    describe('maxCapacityエラー時の特別処理', () => {
      test('maxCapacityエラー時に緊急キュークリアが実行されること', async () => {
        const mockAPICall = jest.fn().mockRejectedValue(
          new Error('throttle queue is over maxCapacity (1000)')
        );

        // emergencyQueueClearanceのモック化
        const originalEmergencyQueueClearance = coordinator.emergencyQueueClearance;
        coordinator.emergencyQueueClearance = jest.fn();

        try {
          await coordinator.executeAPICall(mockAPICall, 'test_request');
        } catch (error) {
          // エラーが期待されているので無視
        }

        // 緊急キュークリアが呼び出されたことを確認
        expect(coordinator.emergencyQueueClearance).toHaveBeenCalled();

        // 元のメソッドを復元
        coordinator.emergencyQueueClearance = originalEmergencyQueueClearance;
      });

      test('maxCapacityエラー時にthrottleMonitorに特別記録されること', async () => {
        const mockAPICall = jest.fn().mockRejectedValue(
          new Error('throttle queue is over maxCapacity (1000)')
        );

        const { throttleMonitor } = require('../../src/common/throttleMonitor');

        try {
          await coordinator.executeAPICall(mockAPICall, 'test_request');
        } catch (error) {
          // エラーが期待されているので無視
        }

        // throttleMonitorに特別なエラー記録が行われたことを確認
        expect(throttleMonitor.recordRequest).toHaveBeenCalledWith(
          true, 
          expect.stringContaining('CRITICAL_MAXCAPACITY')
        );
      });
    });
  });
});