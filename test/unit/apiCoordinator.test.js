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
      
      // queue容量上限まで追加
      const promises = [];
      for (let i = 0; i < EXCHANGE_SETTINGS.MAX_THROTTLE_QUEUE_SIZE; i++) {
        promises.push(coordinator.executeAPICall(mockAPICall, `request_${i}`));
      }
      
      // 容量を超えるリクエストは拒否されるべき
      await expect(coordinator.executeAPICall(mockAPICall, 'overflow_request'))
        .rejects.toThrow('API coordinator queue is full');
    });

    test('優先度順でqueue処理されること', async () => {
      const results = [];
      const mockAPICall = (id) => jest.fn().mockImplementation(async () => {
        results.push(id);
        await new Promise(resolve => setTimeout(resolve, 100));
        return { id };
      });

      // 優先度を変えてリクエストを追加（数値が小さいほど高優先度）
      const promises = [
        coordinator.executeAPICall(mockAPICall('low'), 'low_priority', 3),
        coordinator.executeAPICall(mockAPICall('high'), 'high_priority', 1),
        coordinator.executeAPICall(mockAPICall('medium'), 'medium_priority', 2)
      ];

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
      expect(executionTime).toBeGreaterThanOrEqual(EXCHANGE_SETTINGS.RATE_LIMIT);
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
      const mockAPICall = jest.fn().mockImplementation(() => new Promise(() => {})); // 永続化するPromise
      
      // queueにリクエストを追加
      const promise = coordinator.executeAPICall(mockAPICall, 'test_request');
      
      // 緊急リセット実行
      coordinator.emergencyReset();
      
      // リクエストがキャンセルされることを確認
      await expect(promise).rejects.toThrow('Emergency reset - request cancelled');
      
      // queueがクリアされることを確認
      const stats = coordinator.getStats();
      expect(stats.queueLength).toBe(0);
      expect(stats.activeRequests).toBe(0);
    });
  });

  describe('addToQueue', () => {
    test('優先度順でqueueに追加されること', () => {
      const request1 = { id: 'req1', priority: 3, timestamp: Date.now() };
      const request2 = { id: 'req2', priority: 1, timestamp: Date.now() };
      const request3 = { id: 'req3', priority: 2, timestamp: Date.now() };
      
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
});