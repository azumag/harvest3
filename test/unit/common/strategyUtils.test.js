const { getBalanceCheckEligibleStrategies } = require('../../../src/common/strategyUtils');

describe('getBalanceCheckEligibleStrategies', () => {
  let mockConfig;

  beforeEach(() => {
    // モック設定の準備
    mockConfig = {
      strategies: {
        HFT: {
          type: 'high_frequency',
          enabled: false
        },
        MUTUAL_INFO: {
          type: 'statistical',
          enabled: true
        },
        MEAN_REVERSION: {
          type: 'mean_reversion',
          enabled: true
        },
        MACD: {
          type: 'trend_following',
          enabled: true
        },
        DISABLED_STRATEGY: {
          type: 'trend_following',
          enabled: false
        }
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  describe('基本機能', () => {
    it('残高チェック対象の戦略キーの配列を返すこと', () => {
      const result = getBalanceCheckEligibleStrategies(mockConfig);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(expect.arrayContaining(['MUTUAL_INFO', 'MEAN_REVERSION', 'MACD']));
      expect(result.length).toBe(3);
      expect(result).not.toContain('HFT');
      expect(result).not.toContain('DISABLED_STRATEGY');
    });

    it('enabledがtrueかつhigh_frequency以外の戦略のみを返すこと', () => {
      const result = getBalanceCheckEligibleStrategies(mockConfig);
      
      result.forEach(strategyKey => {
        const strategy = mockConfig.strategies[strategyKey];
        expect(strategy.enabled).toBe(true);
        expect(strategy.type).not.toBe('high_frequency');
      });
    });

    it('引数なしで呼び出された場合はデフォルト設定を使用すること', () => {
      // configモジュールをモック
      jest.doMock('../../../src/config', () => ({
        config: mockConfig
      }));
      
      const { getBalanceCheckEligibleStrategies: getStrategies } = require('../../../src/common/strategyUtils');
      const result = getStrategies();
      
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(expect.arrayContaining(['MUTUAL_INFO', 'MEAN_REVERSION', 'MACD']));
      expect(result.length).toBe(3);
    });
  });

  describe('型によるフィルタリング', () => {
    it('high_frequency型の戦略は除外されること', () => {
      mockConfig.strategies.HFT.enabled = true;
      
      const result = getBalanceCheckEligibleStrategies(mockConfig);
      
      expect(result).not.toContain('HFT');
    });

    it('指定された型の戦略のみを返すオプションがあること', () => {
      const result = getBalanceCheckEligibleStrategies(mockConfig, {
        types: ['trend_following']
      });
      
      expect(result).toEqual(['MACD']);
      expect(result).not.toContain('MUTUAL_INFO');
      expect(result).not.toContain('MEAN_REVERSION');
    });

    it('複数の型を指定できること', () => {
      const result = getBalanceCheckEligibleStrategies(mockConfig, {
        types: ['statistical', 'mean_reversion']
      });
      
      expect(result).toEqual(expect.arrayContaining(['MUTUAL_INFO', 'MEAN_REVERSION']));
      expect(result.length).toBe(2);
      expect(result).not.toContain('MACD');
    });
  });

  describe('エッジケース', () => {
    it('戦略が存在しない場合は空配列を返すこと', () => {
      mockConfig.strategies = {};
      
      const result = getBalanceCheckEligibleStrategies(mockConfig);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('すべての戦略が無効な場合は空配列を返すこと', () => {
      Object.values(mockConfig.strategies).forEach(strategy => {
        strategy.enabled = false;
      });
      
      const result = getBalanceCheckEligibleStrategies(mockConfig);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('high_frequency型の戦略は除外されること', () => {
      mockConfig.strategies.TEST_STRATEGY = {
        type: 'high_frequency',
        enabled: true
      };
      
      const result = getBalanceCheckEligibleStrategies(mockConfig);
      
      expect(result).not.toContain('TEST_STRATEGY');
    });

    it('有効かhigh_frequency以外の戦略は含まれること', () => {
      mockConfig.strategies.VALID_STRATEGY = {
        type: 'trend_following',
        enabled: true
      };
      
      const result = getBalanceCheckEligibleStrategies(mockConfig);
      
      expect(result).toContain('VALID_STRATEGY');
    });

    it('configがnullの場合は空配列を返すこと', () => {
      const result = getBalanceCheckEligibleStrategies(null);
      
      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(0);
    });

    it('config.strategiesがnullの場合は空配列を返すこと', () => {
      const result = getBalanceCheckEligibleStrategies({ strategies: null });
      
      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(0);
    });
  });

  describe('統合テスト', () => {
    it('実際の設定形式で正しく動作すること', () => {
      const realConfig = {
        strategies: {
          HFT: {
            type: 'high_frequency',
            enabled: false,
            function: () => {},
            atomicExec: true,
            exchanges: []
          },
          MUTUAL_INFO: {
            type: 'statistical',
            enabled: true,
            threshold: 0.5,
            ohlcvInterval: '5m',
            deviationThreshold: 3,
            useReturns: true,
            referenceSymbols: 'all',
            function: () => {},
            exchanges: [],
            enableRiskManagement: true,
            riskSettings: {}
          }
        }
      };

      const result = getBalanceCheckEligibleStrategies(realConfig);
      
      expect(result).toEqual(['MUTUAL_INFO']);
    });
  });
});