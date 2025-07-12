const Logger = require('../../../src/hft/utils/Logger');

describe('プロダクション環境ログ清掃のテスト', () => {
  let originalLogLevel;
  let originalConsoleLog;
  let originalConsoleWarn;
  let originalConsoleError;

  beforeEach(() => {
    // 環境変数を保存
    originalLogLevel = process.env.HFT_LOG_LEVEL;
    
    // コンソールメソッドをモック
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
    
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    // 環境変数を復元
    process.env.HFT_LOG_LEVEL = originalLogLevel;
    
    // コンソールメソッドを復元
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe('プロダクション環境での Debug ログ抑制', () => {
    it('本番環境（INFO）ではDEBUGログが出力されない', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const logger = new Logger('ProductionTest');
      
      // 以前のコードのように DEBUG 情報をログしようとする
      logger.debug('availableToSell取得失敗 BTC/JPY: Test error');
      logger.debug('[売却量DEBUG] bitbank BTC/JPY strategy1: net=1.5, sell=0.5');
      logger.debug('[資金DEBUG] BTC/JPY: 利用可能資金=100000円, tradePercentage=0.1');
      logger.debug('Error details for bitbank BTC/JPY 15m: API limit exceeded');
      
      // DEBUG ログは出力されない
      expect(console.log).not.toHaveBeenCalled();
    });

    it('本番環境（INFO）ではINFO以上のログが出力される', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const logger = new Logger('ProductionTest');
      
      // 重要な情報ログ
      logger.info('[リスク管理] ストップロス成功: BTC/JPY - 0.1 BTC');
      logger.warn('[リスク管理] ストップロス失敗: BTC/JPY - 不十分な残高');
      logger.error('[リスク管理] ストップロス実行エラー: BTC/JPY - Connection failed');
      
      // INFO, WARN, ERROR ログは出力される
      expect(console.log).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('開発環境での Debug ログ表示', () => {
    it('開発環境（DEBUG）では全てのログが出力される', () => {
      process.env.HFT_LOG_LEVEL = 'DEBUG';
      const logger = new Logger('DevelopmentTest');
      
      // 全レベルのログを出力
      logger.debug('デバッグ情報: 詳細なトレース');
      logger.info('情報: 正常な動作');
      logger.warn('警告: 注意が必要');
      logger.error('エラー: 何かが失敗');
      
      // 全てのログが出力される
      expect(console.log).toHaveBeenCalledTimes(2); // debug と info
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('修正されたファイルでの Logger 使用パターン', () => {
    it('Bot.js パターン - エラーハンドリング', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const logger = new Logger('Bot');
      
      // 以前は console.warn だったが、適切なログレベルに変更
      logger.debug('availableToSell取得失敗 BTC/JPY: Test error');
      logger.warn('[リスク管理] ストップロス失敗: BTC/JPY - Test error');
      logger.error('[リスク管理] ストップロス実行エラー: BTC/JPY - Connection failed');
      
      // DEBUG は出力されない、WARN と ERROR は出力される
      expect(console.log).not.toHaveBeenCalled(); // DEBUG 分はスキップ
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });

    it('DatabaseManager パターン - デバッグ情報', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const logger = new Logger('DatabaseManager');
      
      // 以前は console.log だったが、debug レベルに変更
      logger.debug('[売却量DEBUG] bitbank BTC/JPY strategy1: net=1.5, sell=0.5');
      logger.debug('[残高DEBUG] bitbank JPY: 100000円 (symbol: BTC/JPY)');
      
      // デバッグ情報は本番環境では出力されない
      expect(console.log).not.toHaveBeenCalled();
    });

    it('StrategyUtils パターン - 資金計算デバッグ', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const logger = new Logger('StrategyUtils');
      
      // 以前は console.log だったが、debug レベルに変更
      logger.debug('[資金DEBUG] BTC/JPY: 利用可能資金=100000円, tradePercentage=0.1, 制限後=10000円');
      
      // デバッグ情報は本番環境では出力されない
      expect(console.log).not.toHaveBeenCalled();
    });

    it('ExchangeAPI パターン - API デバッグ', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const logger = new Logger('ExchangeAPI');
      
      // 以前は console.log だったが、debug レベルに変更
      logger.debug('fetchOHLCVDataAPI呼び出し: bitbank BTC/JPY 15m 100');
      logger.debug('exchange.id: bitbank, timeframe: 15m, mapping: 15min');
      logger.debug('Error details for bitbank BTC/JPY 15m: API limit exceeded');
      
      // デバッグ情報は本番環境では出力されない
      expect(console.log).not.toHaveBeenCalled();
    });

    it('RiskManagement パターン - 詳細ログ', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const logger = new Logger('RiskManagement');
      
      // 以前は大量の console.log だったが、適切なレベルに変更
      logger.debug('executeStopLoss開始: BTC/JPY, strategy: strategy1');
      logger.info('Stop-loss成功: BTC/JPY - 0.1 BTC');
      logger.warn('Position inconsistency detected: net=1.5, actual=0.5');
      logger.error('ストップロス注文の実行に失敗: BTC/JPY - Connection failed');
      
      // DEBUG は出力されない、INFO/WARN/ERROR は出力される
      expect(console.log).toHaveBeenCalledTimes(1); // info
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('パフォーマンス改善の検証', () => {
    it('DEBUG ログの抑制により不要な処理が削減される', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const logger = new Logger('PerformanceTest');
      
      // 複雑なオブジェクトを含むデバッグログ
      const complexObject = {
        orderbook: Array(1000).fill().map((_, i) => ({ price: i, amount: i * 0.1 })),
        analysis: { technical: {}, fundamental: {} },
        metadata: { timestamp: Date.now(), calculations: 'heavy' }
      };
      
      // DEBUG レベルでは処理されない
      logger.debug('複雑なデバッグ情報:', complexObject);
      
      // ログが出力されないことを確認
      expect(console.log).not.toHaveBeenCalled();
    });

    it('重要なログのみが本番環境で出力される', () => {
      process.env.HFT_LOG_LEVEL = 'INFO';
      const logger = new Logger('PerformanceTest');
      
      // 本番環境で必要なログのみ
      logger.info('取引実行: BTC/JPY 売り 0.1 BTC');
      logger.warn('残高不足の警告: BTC/JPY');
      logger.error('API接続エラー: bitbank');
      
      // 重要なログは出力される
      expect(console.log).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('環境変数による動的制御', () => {
    it('LOG_LEVEL 環境変数でも制御される', () => {
      delete process.env.HFT_LOG_LEVEL;
      process.env.LOG_LEVEL = 'WARN';
      
      const logger = new Logger('EnvTest');
      
      logger.debug('デバッグメッセージ');
      logger.info('情報メッセージ');
      logger.warn('警告メッセージ');
      logger.error('エラーメッセージ');
      
      // WARN レベル以上のみ出力
      expect(console.log).not.toHaveBeenCalled(); // debug, info はスキップ
      expect(console.warn).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });

    it('HFT_LOG_LEVEL が LOG_LEVEL より優先される', () => {
      process.env.HFT_LOG_LEVEL = 'ERROR';
      process.env.LOG_LEVEL = 'DEBUG';
      
      const logger = new Logger('PriorityTest');
      
      logger.debug('デバッグメッセージ');
      logger.info('情報メッセージ');
      logger.warn('警告メッセージ');
      logger.error('エラーメッセージ');
      
      // HFT_LOG_LEVEL (ERROR) が優先される
      expect(console.log).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });
});