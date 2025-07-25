/**
 * BacktestErrorClassifier テスト
 * Issue #5260: バックテストサービス: エラー分類の改善
 */

const { BacktestErrorClassifier, ERROR_TYPES, RECOVERY_STRATEGIES } = require('../../../src/common/backtestErrorClassifier');

describe('BacktestErrorClassifier', () => {
  describe('classifyError', () => {
    describe('ネットワークエラーの分類', () => {
      it('一般的なネットワークエラーを正しく分類する', () => {
        const networkErrors = [
          'Network error occurred',
          'connection timeout',
          'ECONNRESET',
          'ENOTFOUND',
          'Too many requests',
          'Rate limit exceeded',
          '429 error',
          '503 Service Unavailable',
          '502 Bad Gateway',
          '504 Gateway Timeout'
        ];

        networkErrors.forEach(errorMessage => {
          const result = BacktestErrorClassifier.classifyError(errorMessage);
          expect(result).toBe(ERROR_TYPES.NETWORK);
        });
      });

      it('Errorオブジェクトのネットワークエラーを正しく分類する', () => {
        const networkError = new Error('Connection timeout');
        const result = BacktestErrorClassifier.classifyError(networkError);
        expect(result).toBe(ERROR_TYPES.NETWORK);
      });

      it('取引所特有のレート制限エラーを分類する', () => {
        const bitbankRateLimit = {
          message: '{"success":0,"data":{"code":50429}}',
          code: '50429'
        };
        const result = BacktestErrorClassifier.classifyError(bitbankRateLimit);
        expect(result).toBe(ERROR_TYPES.NETWORK);
      });
    });

    describe('設定エラーの分類', () => {
      it('一般的な設定エラーを正しく分類する', () => {
        const configErrors = [
          'Authentication failed',
          'Invalid API key',
          'Invalid parameter provided',
          'Missing required field',
          'Invalid symbol BTC/INVALID',
          'Configuration error'
        ];

        configErrors.forEach(errorMessage => {
          const result = BacktestErrorClassifier.classifyError(errorMessage);
          expect(result).toBe(ERROR_TYPES.CONFIG);
        });
      });

      it('取引所特有の認証エラーを分類する', () => {
        const authError = {
          message: '{"success":0,"data":{"code":20001}}',
          code: '20001'
        };
        const result = BacktestErrorClassifier.classifyError(authError);
        expect(result).toBe(ERROR_TYPES.CONFIG);
      });
    });

    describe('システムエラーの分類', () => {
      it('一般的なシステムエラーを正しく分類する', () => {
        const systemErrors = [
          'Database connection failed',
          'MongoDB connection error',
          'Redis connection lost',
          'Insufficient funds',
          'Balance error',
          'System error',
          'Market is closed',
          'Trading suspended'
        ];

        systemErrors.forEach(errorMessage => {
          const result = BacktestErrorClassifier.classifyError(errorMessage);
          expect(result).toBe(ERROR_TYPES.SYSTEM);
        });
      });

      it('取引所特有の残高不足エラーを分類する', () => {
        const insufficientFunds = {
          message: '{"success":0,"data":{"code":20003}}',
          code: '20003'
        };
        const result = BacktestErrorClassifier.classifyError(insufficientFunds);
        expect(result).toBe(ERROR_TYPES.SYSTEM);
      });
    });

    describe('不明なエラーの分類', () => {
      it('分類できないエラーをUNKNOWNとして分類する', () => {
        const unknownErrors = [
          'Some random error',
          'Unexpected error occurred',
          ''
        ];

        unknownErrors.forEach(errorMessage => {
          const result = BacktestErrorClassifier.classifyError(errorMessage);
          expect(result).toBe(ERROR_TYPES.UNKNOWN);
        });
      });

      it('null/undefinedエラーをUNKNOWNとして分類する', () => {
        expect(BacktestErrorClassifier.classifyError(null)).toBe(ERROR_TYPES.UNKNOWN);
        expect(BacktestErrorClassifier.classifyError(undefined)).toBe(ERROR_TYPES.UNKNOWN);
      });
    });
  });

  describe('getRecoveryStrategy', () => {
    it('ネットワークエラーの復旧戦略を正しく返す', () => {
      const strategy = BacktestErrorClassifier.getRecoveryStrategy(ERROR_TYPES.NETWORK);
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.maxRetries).toBe(5);
      expect(strategy.useExponentialBackoff).toBe(true);
      expect(strategy.immediateStop).toBe(false);
    });

    it('設定エラーの復旧戦略を正しく返す', () => {
      const strategy = BacktestErrorClassifier.getRecoveryStrategy(ERROR_TYPES.CONFIG);
      expect(strategy.shouldRetry).toBe(false);
      expect(strategy.maxRetries).toBe(0);
      expect(strategy.useExponentialBackoff).toBe(false);
      expect(strategy.immediateStop).toBe(true);
    });

    it('システムエラーの復旧戦略を正しく返す', () => {
      const strategy = BacktestErrorClassifier.getRecoveryStrategy(ERROR_TYPES.SYSTEM);
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.maxRetries).toBe(3);
      expect(strategy.useExponentialBackoff).toBe(true);
      expect(strategy.immediateStop).toBe(false);
    });

    it('不明なエラー種別の場合はデフォルト戦略を返す', () => {
      const strategy = BacktestErrorClassifier.getRecoveryStrategy('INVALID_TYPE');
      expect(strategy).toEqual(RECOVERY_STRATEGIES[ERROR_TYPES.UNKNOWN]);
    });
  });

  describe('analyzeError', () => {
    it('エラーの詳細分析結果を正しく返す', () => {
      const error = new Error('Network timeout occurred');
      const analysis = BacktestErrorClassifier.analyzeError(error);

      expect(analysis.errorType).toBe(ERROR_TYPES.NETWORK);
      expect(analysis.message).toBe('Network timeout occurred');
      expect(analysis.strategy).toEqual(RECOVERY_STRATEGIES[ERROR_TYPES.NETWORK]);
      expect(analysis.classification.isNetworkError).toBe(true);
      expect(analysis.classification.isConfigError).toBe(false);
      expect(analysis.classification.isSystemError).toBe(false);
      expect(analysis.classification.isUnknownError).toBe(false);
    });

    it('設定エラーの分析結果を正しく返す', () => {
      const error = 'Invalid API key provided';
      const analysis = BacktestErrorClassifier.analyzeError(error);

      expect(analysis.errorType).toBe(ERROR_TYPES.CONFIG);
      expect(analysis.message).toBe('Invalid API key provided');
      expect(analysis.classification.isConfigError).toBe(true);
      expect(analysis.classification.isNetworkError).toBe(false);
    });

    it('システムエラーの分析結果を正しく返す', () => {
      const error = new Error('Database connection failed');
      const analysis = BacktestErrorClassifier.analyzeError(error);

      expect(analysis.errorType).toBe(ERROR_TYPES.SYSTEM);
      expect(analysis.classification.isSystemError).toBe(true);
      expect(analysis.classification.isNetworkError).toBe(false);
      expect(analysis.classification.isConfigError).toBe(false);
    });
  });

  describe('エラー種別判定メソッド', () => {
    describe('isNetworkError', () => {
      it('ネットワーク関連キーワードを正しく検出する', () => {
        expect(BacktestErrorClassifier.isNetworkError({}, 'network error')).toBe(true);
        expect(BacktestErrorClassifier.isNetworkError({}, 'connection timeout')).toBe(true);
        expect(BacktestErrorClassifier.isNetworkError({}, 'rate limit exceeded')).toBe(true);
        expect(BacktestErrorClassifier.isNetworkError({}, 'random error')).toBe(false);
      });
    });

    describe('isConfigError', () => {
      it('設定関連キーワードを正しく検出する', () => {
        expect(BacktestErrorClassifier.isConfigError({}, 'authentication failed')).toBe(true);
        expect(BacktestErrorClassifier.isConfigError({}, 'invalid parameter')).toBe(true);
        expect(BacktestErrorClassifier.isConfigError({}, 'api key error')).toBe(true);
        expect(BacktestErrorClassifier.isConfigError({}, 'random error')).toBe(false);
      });
    });

    describe('isSystemError', () => {
      it('システム関連キーワードを正しく検出する', () => {
        expect(BacktestErrorClassifier.isSystemError({}, 'database error')).toBe(true);
        expect(BacktestErrorClassifier.isSystemError({}, 'insufficient funds')).toBe(true);
        expect(BacktestErrorClassifier.isSystemError({}, 'system error')).toBe(true);
        expect(BacktestErrorClassifier.isSystemError({}, 'random error')).toBe(false);
      });
    });
  });

  describe('復旧戦略の定数', () => {
    it('ERROR_TYPESが正しく定義されている', () => {
      expect(ERROR_TYPES.NETWORK).toBe('NETWORK');
      expect(ERROR_TYPES.CONFIG).toBe('CONFIG');
      expect(ERROR_TYPES.SYSTEM).toBe('SYSTEM');
      expect(ERROR_TYPES.UNKNOWN).toBe('UNKNOWN');
    });

    it('RECOVERY_STRATEGIESが全てのエラー種別に対して定義されている', () => {
      Object.values(ERROR_TYPES).forEach(errorType => {
        expect(RECOVERY_STRATEGIES[errorType]).toBeDefined();
        expect(RECOVERY_STRATEGIES[errorType]).toHaveProperty('shouldRetry');
        expect(RECOVERY_STRATEGIES[errorType]).toHaveProperty('maxRetries');
        expect(RECOVERY_STRATEGIES[errorType]).toHaveProperty('useExponentialBackoff');
        expect(RECOVERY_STRATEGIES[errorType]).toHaveProperty('immediateStop');
        expect(RECOVERY_STRATEGIES[errorType]).toHaveProperty('description');
      });
    });
  });
});