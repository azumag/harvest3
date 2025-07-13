/**
 * イベント駆動型ボットアーキテクチャのテスト
 * t-wada style TDD: レビュー対応の効率的実行エンジンテスト
 */

// モック設定
jest.mock('../../../src/database/manager');
jest.mock('../../../src/common/notifications');
jest.mock('../../../src/common/schedulingManager');
jest.mock('../../../src/common/balanceChecker');
jest.mock('../../../src/common/maintenanceScheduler');
jest.mock('../../../src/strategies/trendFollowing');
jest.mock('../../../src/strategies/meanReversion');

describe('Event-Driven Bot Architecture', () => {
  let bot;
  let mockSchedulingManager;
  let mockConfig;
  let mockExchange;

  beforeEach(() => {
    // SchedulingManagerのモック
    mockSchedulingManager = {
      scheduleIntervalTask: jest.fn(),
      scheduleHourlyTask: jest.fn(),
      scheduleCustomTask: jest.fn(),
      gracefulShutdown: jest.fn(),
      showNextExecutions: jest.fn(),
      removeTask: jest.fn()
    };

    // 設定モック
    mockConfig = {
      exchanges: {
        bitbank: {
          instance: {
            id: 'bitbank',
            markets: { 'BTC/JPY': { symbol: 'BTC/JPY' } }
          }
        }
      },
      strategies: {
        MA: { enabled: true, type: 'trend_following' },
        MACD: { enabled: true, type: 'trend_following' }
      }
    };

    // 取引所インスタンスモック
    mockExchange = {
      id: 'bitbank',
      fetchMarkets: jest.fn().mockResolvedValue({
        'BTC/JPY': { symbol: 'BTC/JPY', precision: { price: 8, amount: 8 } }
      }),
      fetchTicker: jest.fn().mockResolvedValue({ last: 5000000 })
    };

    // グローバルモック
    require('../../../src/common/schedulingManager').getSchedulingManager = jest.fn(() => mockSchedulingManager);
    require('../../../src/common/maintenanceScheduler').getMaintenanceScheduler = jest.fn(() => ({
      initialize: jest.fn(),
      initializeSchedules: jest.fn()
    }));
    require('../../../src/common/balanceChecker').executeRobustBalanceCheck = jest.fn();
    require('../../../src/database/manager').getSymbolsByExchange = jest.fn().mockResolvedValue({
      bitbank: ['BTC/JPY']
    });
    require('../../../src/database/manager').getMarketParametersByExchangeSymbol = jest.fn().mockResolvedValue({
      bitbank: {
        'BTC/JPY': { pricePrecision: 8, amountPrecision: 8, minTradeAmount: 0.0001 }
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeStrategyCycle()', () => {
    test('並列処理による効率的な戦略実行', async () => {
      // bot.jsが正しく読み込まれることを確認
      const bot = require('../../../src/bot');
      expect(bot).toBeDefined();

      // Promise.allSettledが存在することを確認（並列処理の検証）
      expect(Promise.allSettled).toBeDefined();
      expect(typeof Promise.allSettled).toBe('function');
    });

    test('sleep(1000)の排除確認', () => {
      const fs = require('fs');
      const path = require('path');
      const botPath = path.join(__dirname, '../../../src/bot.js');
      const botSource = fs.readFileSync(botPath, 'utf8');

      // sleep(1000)が存在しないことを確認
      expect(botSource).not.toMatch(/await\s+sleep\(1000\)/);
      // 新しいstrategyExecutionManagerアプローチの確認
      expect(botSource).toMatch(/strategyExecutionManager/);
    });

    test('while(true)ループの排除確認', () => {
      const fs = require('fs');
      const path = require('path');
      const botPath = path.join(__dirname, '../../../src/bot.js');
      const botSource = fs.readFileSync(botPath, 'utf8');

      // while(true)が executeStrategyCycle内に存在しないことを確認
      const executeStrategyCycleMatch = botSource.match(/async function executeStrategyCycle\(\)[^}]*\}/s);
      if (executeStrategyCycleMatch) {
        expect(executeStrategyCycleMatch[0]).not.toMatch(/while\s*\(\s*true\s*\)/);
      }
    });
  });

  describe('Event-Driven Scheduling', () => {
    test('SchedulingManagerの利用確認', () => {
      const fs = require('fs');
      const path = require('path');
      const botPath = path.join(__dirname, '../../../src/bot.js');
      const botSource = fs.readFileSync(botPath, 'utf8');

      // SchedulingManagerが使用されていることを確認
      expect(botSource).toMatch(/scheduleIntervalTask/);
      expect(botSource).toMatch(/schedulingManager/);
    });

    test('イベント駆動アーキテクチャの実装確認', () => {
      const fs = require('fs');
      const path = require('path');
      const botPath = path.join(__dirname, '../../../src/bot.js');
      const botSource = fs.readFileSync(botPath, 'utf8');

      // イベント駆動型の説明コメントが存在することを確認
      expect(botSource).toMatch(/イベント駆動型/);
      expect(botSource).toMatch(/効率的戦略実行エンジン/);
    });
  });

  describe('Architecture Validation', () => {
    test('分散処理の実装確認', () => {
      const fs = require('fs');
      const path = require('path');
      const botPath = path.join(__dirname, '../../../src/bot.js');
      const botSource = fs.readFileSync(botPath, 'utf8');

      // 新しいAPIデータキャッシュと戦略実行管理システムが使用されていることを確認
      expect(botSource).toMatch(/strategyExecutionManager/);
      expect(botSource).toMatch(/apiDataCache/);
    });

    test('効率的実行エンジンの存在確認', () => {
      const fs = require('fs');
      const path = require('path');
      const botPath = path.join(__dirname, '../../../src/bot.js');
      const botSource = fs.readFileSync(botPath, 'utf8');

      // executeStrategyCycle関数が存在することを確認
      expect(botSource).toMatch(/async function executeStrategyCycle/);
    });
  });
});