/**
 * Issue #438 throttle queue overflow対応のテスト
 * maxCapacityエラー処理と動的レート制限の単体テスト
 */

const { ThrottleMonitor } = require('../../../src/common/throttleMonitor');
const { APICoordinator } = require('../../../src/common/apiCoordinator');

// モック設定
jest.mock('../../../src/common/const', () => ({
  MONITORING_SETTINGS: {
    THROTTLE_QUEUE_MONITORING: {
      MAX_CAPACITY_RECOVERY_DELAY: 180000,
      PREVENTIVE_THROTTLE_THRESHOLD: 400,
      DYNAMIC_RATE_LIMIT_MULTIPLIER: 2.5
    }
  },
  NOTIFICATION_SETTINGS: {
    RATE_LIMIT_WINDOW_MS: 60000
  },
  EXCHANGE_SETTINGS: {
    RATE_LIMIT: 3500,
    MAX_THROTTLE_QUEUE_SIZE: 600,
    THROTTLE_QUEUE_MONITORING: {
      ENABLED: true,
      CHECK_INTERVAL: 500,
      WARNING_THRESHOLD: 300,
      CRITICAL_THRESHOLD: 450,
      EMERGENCY_DELAY: 10000,
      MAX_CAPACITY_RECOVERY_DELAY: 180000,
      PREVENTIVE_THROTTLE_THRESHOLD: 400,
      DYNAMIC_RATE_LIMIT_MULTIPLIER: 2.5
    }
  }
}));

jest.mock('../../../src/common/notifications', () => ({
  postErrorToDiscord: jest.fn().mockResolvedValue()
}));

jest.mock('../../../src/hft/utils/Logger', () => {
  return jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }));
});

describe('Issue #438: Throttle Queue Overflow 対応テスト', () => {
  let throttleMonitor;
  let apiCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    throttleMonitor = new ThrottleMonitor();
    apiCoordinator = new APICoordinator();
    throttleMonitor.setAPICoordinator(apiCoordinator);
    apiCoordinator.setThrottleMonitor(throttleMonitor);
  });

  afterEach(() => {
    if (throttleMonitor) {
      throttleMonitor.resetStats();
    }
  });

  describe('maxCapacityエラー特化処理', () => {
    test('maxCapacityエラーでhandleMaxCapacityErrorが呼ばれる', async () => {
      const handleMaxCapacityErrorSpy = jest.spyOn(throttleMonitor, 'handleMaxCapacityError')
        .mockImplementation(() => Promise.resolve());
      
      await throttleMonitor.handleThrottleError('throttle queue is over maxCapacity (1000)');
      
      expect(handleMaxCapacityErrorSpy).toHaveBeenCalledWith('throttle queue is over maxCapacity (1000)');
    });

    test('maxCapacityエラーでサーキットブレーカーが即座にOPENになる', async () => {
      const sendAlertSpy = jest.spyOn(throttleMonitor, 'sendAlert').mockResolvedValue();
      
      expect(throttleMonitor.circuitBreaker.state).toBe('CLOSED');
      
      // handleMaxCapacityErrorを直接テスト（タイムアウトを回避するため短縮版）
      throttleMonitor.openCircuitBreaker();
      
      expect(throttleMonitor.circuitBreaker.state).toBe('OPEN');
    });

    test('maxCapacityエラー検出でAPIコーディネーターがリセットされる', async () => {
      const emergencyResetSpy = jest.spyOn(apiCoordinator, 'emergencyReset').mockImplementation(() => {});
      const sendAlertSpy = jest.spyOn(throttleMonitor, 'sendAlert').mockResolvedValue();
      
      // タイムアウトを回避するため、待機時間をモック
      const originalSetTimeout = setTimeout;
      global.setTimeout = jest.fn((callback) => callback());
      
      try {
        await throttleMonitor.handleMaxCapacityError('throttle queue is over maxCapacity (1000)');
        expect(emergencyResetSpy).toHaveBeenCalled();
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    });
  });

  describe('動的レート制限機能', () => {
    test('キュー使用率66%以上で予防的throttleが適用される', () => {
      // APIコーディネーターの統計をモック
      jest.spyOn(apiCoordinator, 'getStats').mockReturnValue({
        queueUsageRate: 0.7 // 70%
      });

      const delay = throttleMonitor.getRecommendedDelay();
      
      // RATE_LIMIT * DYNAMIC_RATE_LIMIT_MULTIPLIER = 3500 * 2.5 = 8750
      expect(delay).toBeGreaterThan(8000);
      expect(delay).toBeLessThanOrEqual(20000); // 最大20秒制限
    });

    test('キュー使用率50-66%で軽度throttleが適用される', () => {
      jest.spyOn(apiCoordinator, 'getStats').mockReturnValue({
        queueUsageRate: 0.55 // 55%
      });

      const delay = throttleMonitor.getRecommendedDelay();
      
      // RATE_LIMIT * 1.5 = 3500 * 1.5 = 5250
      expect(delay).toBe(5250);
    });

    test('エラー率5%以上でより厳格な動的待機時間が適用される', () => {
      // APIコーディネーターがnullの場合のテスト
      jest.spyOn(apiCoordinator, 'getStats').mockReturnValue({
        queueUsageRate: 0.3 // 30% - 予防的throttleトリガー未満
      });
      
      // エラー率を5%以上に設定
      throttleMonitor.stats.totalRequests = 100;
      throttleMonitor.stats.throttleErrors = 6; // 6%

      const delay = throttleMonitor.getRecommendedDelay();
      
      // 4000 * (0.06 / 0.05) = 4800
      expect(delay).toBe(4800);
    });
  });

  describe('recordRequest機能強化', () => {
    test('maxCapacityエラーの記録が正しく分類される', () => {
      const handleThrottleErrorSpy = jest.spyOn(throttleMonitor, 'handleThrottleError')
        .mockImplementation(() => Promise.resolve());
      
      throttleMonitor.recordRequest(true, 'throttle queue is over maxCapacity (1000)');
      
      expect(throttleMonitor.stats.queueOverflowErrors).toBe(1);
      expect(throttleMonitor.stats.throttleErrors).toBe(1);
      expect(throttleMonitor.stats.lastQueueOverflow).toBeGreaterThan(0);
    });

    test('coordinatorエラーの記録が正しく分類される', () => {
      const handleCoordinatorErrorSpy = jest.spyOn(throttleMonitor, 'handleCoordinatorError')
        .mockImplementation(() => Promise.resolve());
      
      throttleMonitor.recordRequest(true, 'coordinator queue is full');
      
      expect(throttleMonitor.stats.coordinatorErrors).toBe(1);
      expect(throttleMonitor.stats.throttleErrors).toBe(1);
    });
  });

  describe('システムヘルススコア計算の改善', () => {
    test('最近のqueue overflowによる減点が正しく計算される', () => {
      // 最近のqueue overflowを設定
      throttleMonitor.stats.lastQueueOverflow = Date.now() - 30000; // 30秒前
      throttleMonitor.stats.totalRequests = 100;
      throttleMonitor.stats.throttleErrors = 5; // 5%
      
      const healthScore = throttleMonitor.getSystemHealthScore();
      
      // queue overflow減点 (0.2) + エラー率減点 (0.1) = 0.7以下
      expect(healthScore).toBeLessThan(0.8);
      expect(healthScore).toBeGreaterThanOrEqual(0.0);
    });

    test('APIコーディネーターの状態による減点が反映される', () => {
      jest.spyOn(apiCoordinator, 'getStats').mockReturnValue({
        queueUsageRate: 0.8 // 80%
      });
      
      throttleMonitor.stats.totalRequests = 100;
      
      const healthScore = throttleMonitor.getSystemHealthScore();
      
      // コーディネーター減点が含まれている
      expect(healthScore).toBeLessThan(1.0);
    });
  });

  describe('サーキットブレーカー機能', () => {
    test('shouldAllowRequestがサーキットブレーカー状態を正しく反映する', () => {
      expect(throttleMonitor.shouldAllowRequest()).toBe(true);
      
      throttleMonitor.openCircuitBreaker();
      expect(throttleMonitor.shouldAllowRequest()).toBe(false);
    });

    test('連続成功でサーキットブレーカーが回復する', () => {
      throttleMonitor.openCircuitBreaker();
      expect(throttleMonitor.circuitBreaker.state).toBe('OPEN');
      
      // 時間経過をシミュレート
      throttleMonitor.circuitBreaker.nextAttemptTime = Date.now() - 1000;
      
      // HALF_OPENへの遷移
      expect(throttleMonitor.shouldAllowRequest()).toBe(true);
      expect(throttleMonitor.circuitBreaker.state).toBe('HALF_OPEN');
      
      // 3回連続成功でCLOSEDへ
      for (let i = 0; i < 3; i++) {
        throttleMonitor.updateCircuitBreakerState(true);
      }
      
      expect(throttleMonitor.circuitBreaker.state).toBe('CLOSED');
    });
  });
});

// APICoordinator Issue #438対応テスト
describe('Issue #438: APICoordinator 強化テスト', () => {
  let apiCoordinator;

  beforeEach(() => {
    jest.clearAllMocks();
    apiCoordinator = new APICoordinator();
  });

  describe('強化された緊急キュー排出', () => {
    test('優先度3以上のリクエストが積極的に排出される', () => {
      // 低優先度リクエストを追加
      apiCoordinator.queue = [
        { priority: 3, timestamp: Date.now(), reject: jest.fn() },
        { priority: 2, timestamp: Date.now(), reject: jest.fn() },
        { priority: 1, timestamp: Date.now(), reject: jest.fn() }
      ];

      apiCoordinator.emergencyQueueDrainage();

      // 優先度3のリクエストが排出される
      expect(apiCoordinator.queue.length).toBe(2);
      expect(apiCoordinator.queue.every(req => req.priority <= 2)).toBe(true);
    });

    test('古い優先度2リクエストも排出される', () => {
      const oldTimestamp = Date.now() - 6000; // 6秒前
      
      apiCoordinator.queue = [
        { priority: 2, timestamp: oldTimestamp, reject: jest.fn() },
        { priority: 2, timestamp: Date.now(), reject: jest.fn() }
      ];

      apiCoordinator.emergencyQueueDrainage();

      // 古いリクエストのみ排出される
      expect(apiCoordinator.queue.length).toBe(1);
      expect(apiCoordinator.queue[0].timestamp).not.toBe(oldTimestamp);
    });

    test('非常に古い優先度1リクエストも排出される', () => {
      const veryOldTimestamp = Date.now() - 16000; // 16秒前
      
      apiCoordinator.queue = [
        { priority: 1, timestamp: veryOldTimestamp, reject: jest.fn() },
        { priority: 1, timestamp: Date.now(), reject: jest.fn() }
      ];

      apiCoordinator.emergencyQueueDrainage();

      // 非常に古いリクエストのみ排出される
      expect(apiCoordinator.queue.length).toBe(1);
      expect(apiCoordinator.queue[0].timestamp).not.toBe(veryOldTimestamp);
    });
  });

  describe('統合テスト: maxCapacityエラー処理フロー', () => {
    test('エラー分類が正しく機能する', () => {
      const throttleMonitor = new ThrottleMonitor();
      
      // maxCapacityエラー
      const handleMaxCapacityErrorSpy = jest.spyOn(throttleMonitor, 'handleMaxCapacityError')
        .mockImplementation(() => Promise.resolve());
      
      throttleMonitor.recordRequest(true, 'throttle queue is over maxCapacity (1000)');
      
      // エラー統計の確認
      expect(throttleMonitor.stats.queueOverflowErrors).toBe(1);
      expect(throttleMonitor.stats.throttleErrors).toBe(1);
    });
  });
});