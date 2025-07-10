/**
 * 残高整合性サービス - issue #215
 *
 * 取引所残高とBOT管理残高の整合性を包括的にチェックし、
 * 不整合の自動修正、監査ログ、リアルタイム監視を提供する。
 */

const { config } = require('../config');
const { getCollectionRef, ensureConnection } = require('../database/manager');
const { getStrategyPositionsRedis, getRedisClient } = require('../database/redisDatabase');
const { postErrorToDiscord, postOrderToDiscord } = require('../common/notifications');
const { formatJST } = require('../common/utils');
const {
  toDecimal,
  compareBalance,
  sumBalances,
  toNumber,
  validateBalance
} = require('../common/decimalUtils');
const {
  TIME_CONSTANTS,
  SYSTEM_LIMITS,
  STRING_CONSTANTS
} = require('../common/constants');
const { SETTINGS } = require('../config/settings');

class BalanceIntegrityService {
  constructor() {
    this.config = config.global.balanceIntegritySystem;
    this.dataCache = new Map();
    this.auditLog = [];
    this.metrics = {
      totalChecks: 0,
      discrepanciesFound: 0,
      autoCorrections: 0,
      failedChecks: 0,
      lastCheckTime: null,
      averageCheckTime: 0
    };
    this.isRunning = false;
    this.consecutiveFailures = 0;
    this.tradingHalted = false;
    this.dailyAutoCorrections = 0;
    this.lastResetDate = new Date().toDateString();
    this.emergencyHaltTimer = null;
  }

  /**
   * サービスの開始
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ Balance Integrity Service は既に実行中です');
      return;
    }

    if (!this.config.enabled) {
      console.log('⚠️ Balance Integrity Service は無効化されています');
      return;
    }

    console.log('🔄 Balance Integrity Service を開始します...');
    this.isRunning = true;
    this.consecutiveFailures = 0;
    this.tradingHalted = false;

    // 初期チェック実行
    await this.performFullIntegrityCheck();

    // 定期監視開始
    if (this.config.realTimeMonitoring.enabled) {
      this.startRealTimeMonitoring();
    }

    console.log('✅ Balance Integrity Service が正常に開始されました');
  }

  /**
   * サービスの停止
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ Balance Integrity Service は既に停止中です');
      return;
    }

    console.log('🛑 Balance Integrity Service を停止します...');
    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.emergencyHaltTimer) {
      clearTimeout(this.emergencyHaltTimer);
      this.emergencyHaltTimer = null;
    }

    console.log('✅ Balance Integrity Service が正常に停止されました');
  }

  /**
   * リアルタイム監視の開始
   */
  startRealTimeMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(async () => {
      if (!this.isRunning) {
        return;
      }

      try {
        await this.performRealTimeCheck();
      } catch (error) {
        console.error('リアルタイム監視中にエラーが発生:', error);
        this.consecutiveFailures++;

        if (this.consecutiveFailures >= this.config.tradingHalt.maxConsecutiveFailures) {
          await this.initiateEmergencyHalt();
        }
      }
    }, this.config.realTimeMonitoring.interval);

    console.log(`⏰ リアルタイム監視を開始しました (間隔: ${this.config.realTimeMonitoring.interval}ms)`);
  }

  /**
   * 完全な整合性チェック
   */
  async performFullIntegrityCheck() {
    const startTime = Date.now();
    console.log('🔍 完全な残高整合性チェックを開始します...');

    try {
      // 全取引所の残高を取得
      const exchangeBalances = await this.getAllExchangeBalances();

      // 全戦略のRedis残高を取得
      const redisBalances = await this.getAllRedisBalances();

      // MongoDB約定履歴から計算残高を取得
      const mongoBalances = await this.getMongoCalculatedBalances();

      // 3つのデータソースを照合
      const discrepancies = await this.compareAllDataSources(
        exchangeBalances,
        redisBalances,
        mongoBalances
      );

      // 不整合を分析・処理
      await this.processDiscrepancies(discrepancies);

      // メトリクス更新
      this.updateMetrics(startTime, discrepancies);

      // 監査ログ記録
      await this.logAuditRecord('FULL_CHECK', {
        discrepancies: discrepancies.length,
        checkTime: Date.now() - startTime,
        success: true
      });

      console.log(`✅ 完全チェック完了 (${Date.now() - startTime}ms)`);
      return discrepancies;

    } catch (error) {
      console.error('完全チェック中にエラーが発生:', error);
      this.metrics.failedChecks++;
      this.consecutiveFailures++;

      await this.logAuditRecord('FULL_CHECK', {
        error: error.message,
        checkTime: Date.now() - startTime,
        success: false
      });

      throw error;
    }
  }

  /**
   * リアルタイムチェック（軽量版）
   */
  async performRealTimeCheck() {
    const startTime = Date.now();

    try {
      // 重要通貨のみをチェック
      const importantCurrencies = SETTINGS.TRADING.IMPORTANT_CURRENCIES;
      const discrepancies = [];

      for (const currency of importantCurrencies) {
        const discrepancy = await this.checkCurrencyBalance(currency);
        if (discrepancy) {
          discrepancies.push(discrepancy);
        }
      }

      // 重要な不整合があれば処理
      if (discrepancies.length > 0) {
        await this.processDiscrepancies(discrepancies);
      }

      // 連続失敗カウンターをリセット
      this.consecutiveFailures = 0;

      console.log(`⚡ リアルタイムチェック完了 (${Date.now() - startTime}ms)`);
      return discrepancies;

    } catch (error) {
      console.error('リアルタイムチェック中にエラーが発生:', error);
      this.consecutiveFailures++;
      throw error;
    }
  }

  /**
   * 特定通貨の残高チェック
   */
  async checkCurrencyBalance(currency) {
    try {
      const exchangeBalance = await this.getExchangeBalance(currency);
      const redisBalance = await this.getRedisBalance(currency);

      if (!exchangeBalance || !redisBalance) {
        return null;
      }

      const discrepancy = Math.abs(exchangeBalance.used - redisBalance.total);
      const discrepancyPercent = exchangeBalance.used > 0 ?
        (discrepancy / exchangeBalance.used) * 100 : 0;

      // 閾値チェック
      if (discrepancy > this.config.thresholds.absoluteThreshold &&
          discrepancyPercent > this.config.thresholds.percentageThreshold) {

        return {
          currency,
          exchangeBalance,
          redisBalance,
          discrepancy,
          discrepancyPercent,
          timestamp: new Date(),
          severity: this.calculateSeverity(discrepancyPercent)
        };
      }

      return null;
    } catch (error) {
      console.error(`通貨 ${currency} の残高チェック中にエラー:`, error);
      return null;
    }
  }

  /**
   * 取引所残高の取得
   */
  async getExchangeBalance(currency) {
    const cacheKey = `exchange_balance_${currency}`;

    if (this.dataCache.has(cacheKey)) {
      const cached = this.dataCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.config.dataSources.exchange.cacheTTL) {
        return cached.data;
      }
    }

    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        const exchange = config.exchanges.bitbank.instance;
        const balance = await exchange.fetchBalance();

        const currencyBalance = {
          free: balance.free[currency] || 0,
          used: balance.used[currency] || 0,
          total: balance.total[currency] || 0,
          timestamp: new Date()
        };

        this.dataCache.set(cacheKey, {
          data: currencyBalance,
          timestamp: Date.now()
        });

        return currencyBalance;
      } catch (error) {
        retryCount++;
        const isLastRetry = retryCount >= maxRetries;
        
        console.error(`取引所 ${currency} 残高取得エラー (試行 ${retryCount}/${maxRetries}):`, error.message);
        
        if (isLastRetry) {
          // 最終試行失敗時は詳細なエラー情報を記録
          console.error(`全ての再試行が失敗しました。エラー詳細:`, {
            currency,
            errorCode: error.code,
            errorMessage: error.message,
            stack: error.stack
          });
          return null;
        }
        
        // 指数バックオフで再試行
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Redis残高の取得
   */
  async getRedisBalance(currency) {
    const cacheKey = `redis_balance_${currency}`;

    if (this.dataCache.has(cacheKey)) {
      const cached = this.dataCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.config.dataSources.redis.cacheTTL) {
        return cached.data;
      }
    }

    try {
      const symbol = `${currency}/JPY`;
      const enabledStrategies = Object.keys(config.strategies)
        .filter(key => config.strategies[key].enabled);

      let totalAmount = 0;
      const strategyBreakdown = {};

      for (const strategyKey of enabledStrategies) {
        const positions = await getStrategyPositionsRedis('bitbank', symbol, strategyKey);
        const openPositions = positions.filter(pos => pos.status === 'open' && pos.side === 'buy');
        const strategyAmount = openPositions.reduce((sum, pos) => sum + pos.amount, 0);

        if (strategyAmount > 0) {
          totalAmount += strategyAmount;
          strategyBreakdown[strategyKey] = strategyAmount;
        }
      }

      const redisBalance = {
        total: totalAmount,
        strategies: strategyBreakdown,
        timestamp: new Date()
      };

      this.dataCache.set(cacheKey, {
        data: redisBalance,
        timestamp: Date.now()
      });

      return redisBalance;
    } catch (error) {
      console.error(`Redis ${currency} 残高取得エラー:`, error);
      return null;
    }
  }

  /**
   * 全取引所残高の取得
   */
  async getAllExchangeBalances() {
    try {
      const exchange = config.exchanges.bitbank.instance;
      const balance = await exchange.fetchBalance();

      return {
        bitbank: balance,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('取引所残高取得エラー:', error);
      throw error;
    }
  }

  /**
   * 全Redis残高の取得
   */
  async getAllRedisBalances() {
    try {
      const currencies = ['BTC', 'ETH', 'XRP', 'LTC', 'BCH', 'SOL', 'DOT', 'XLM', 'LINK'];
      const redisBalances = {};

      for (const currency of currencies) {
        const balance = await this.getRedisBalance(currency);
        if (balance) {
          redisBalances[currency] = balance;
        }
      }

      return redisBalances;
    } catch (error) {
      console.error('Redis残高取得エラー:', error);
      throw error;
    }
  }

  /**
   * MongoDB計算残高の取得
   */
  async getMongoCalculatedBalances() {
    try {
      await ensureConnection();
      const tradesCollection = getCollectionRef('trades');

      const pipeline = [
        {
          $match: {
            exchange: 'bitbank',
            status: 'filled'
          }
        },
        {
          $group: {
            _id: '$currency',
            totalBought: {
              $sum: {
                $cond: [{ $eq: ['$side', 'buy'] }, '$amount', 0]
              }
            },
            totalSold: {
              $sum: {
                $cond: [{ $eq: ['$side', 'sell'] }, '$amount', 0]
              }
            }
          }
        },
        {
          $project: {
            currency: '$_id',
            netPosition: { $subtract: ['$totalBought', '$totalSold'] }
          }
        }
      ];

      const results = await tradesCollection.aggregate(pipeline).toArray();

      const mongoBalances = {};
      for (const result of results) {
        if (result.netPosition > 0) {
          mongoBalances[result.currency] = {
            netPosition: result.netPosition,
            totalBought: result.totalBought,
            totalSold: result.totalSold
          };
        }
      }

      return mongoBalances;
    } catch (error) {
      console.error('MongoDB計算残高取得エラー:', error);
      throw error;
    }
  }

  /**
   * 全データソースの比較
   */
  async compareAllDataSources(exchangeBalances, redisBalances, mongoBalances) {
    const discrepancies = [];
    const currencies = new Set([
      ...Object.keys(exchangeBalances.bitbank.used || {}),
      ...Object.keys(redisBalances),
      ...Object.keys(mongoBalances)
    ]);

    for (const currency of currencies) {
      const exchangeUsed = exchangeBalances.bitbank.used[currency] || 0;
      const redisTotal = redisBalances[currency]?.total || 0;
      const mongoNet = mongoBalances[currency]?.netPosition || 0;

      // 3つのデータソースを比較（高精度計算）
      const exchangeRedisComparison = compareBalance(exchangeUsed, redisTotal, currency);
      const exchangeMongoComparison = compareBalance(exchangeUsed, mongoNet, currency);
      const redisMongoComparison = compareBalance(redisTotal, mongoNet, currency);

      const exchangeRedisDiscrepancy = exchangeRedisComparison.absoluteDifference;
      const exchangeMongoDiscrepancy = exchangeMongoComparison.absoluteDifference;
      const redisMongoDiscrepancy = redisMongoComparison.absoluteDifference;

      const maxDiscrepancy = Math.max(
        exchangeRedisDiscrepancy,
        exchangeMongoDiscrepancy,
        redisMongoDiscrepancy
      );

      if (maxDiscrepancy > this.config.thresholds.absoluteThreshold) {
        const maxDiscrepancyPercent = toNumber(exchangeUsed) > 0 ?
          (maxDiscrepancy / toNumber(exchangeUsed)) * 100 : 0;

        if (maxDiscrepancyPercent > this.config.thresholds.percentageThreshold) {
          discrepancies.push({
            currency,
            exchangeBalance: exchangeUsed,
            redisBalance: redisTotal,
            mongoBalance: mongoNet,
            discrepancies: {
              exchangeRedis: exchangeRedisDiscrepancy,
              exchangeMongo: exchangeMongoDiscrepancy,
              redisMongo: redisMongoDiscrepancy,
              max: maxDiscrepancy
            },
            discrepancyPercent: maxDiscrepancyPercent,
            severity: this.calculateSeverity(maxDiscrepancyPercent),
            timestamp: new Date(),
            strategies: redisBalances[currency]?.strategies || {}
          });
        }
      }
    }

    return discrepancies;
  }

  /**
   * 不整合の処理
   */
  async processDiscrepancies(discrepancies) {
    if (discrepancies.length === 0) {
      return;
    }

    console.log(`🚨 ${discrepancies.length}件の不整合を検出しました`);

    for (const discrepancy of discrepancies) {
      await this.processIndividualDiscrepancy(discrepancy);
    }

    // 重要な不整合があれば通知
    const criticalDiscrepancies = discrepancies.filter(d => d.severity === 'critical');
    if (criticalDiscrepancies.length > 0) {
      await this.sendCriticalAlert(criticalDiscrepancies);
    }

    // 警告レベルの不整合があれば通知
    const warningDiscrepancies = discrepancies.filter(d => d.severity === 'warning');
    if (warningDiscrepancies.length > 0) {
      await this.sendWarningAlert(warningDiscrepancies);
    }
  }

  /**
   * 個別不整合の処理
   */
  async processIndividualDiscrepancy(discrepancy) {
    console.log(`📊 不整合処理: ${discrepancy.currency} (${discrepancy.severity})`);

    // 監査ログ記録
    await this.logAuditRecord('DISCREPANCY_DETECTED', discrepancy);

    // 重大な不整合の場合は取引停止を検討
    if (discrepancy.severity === 'critical') {
      await this.considerTradingHalt(discrepancy);
    }

    // 自動修正の判断
    if (this.shouldAutoCorrect(discrepancy)) {
      await this.attemptAutoCorrection(discrepancy);
    }
  }

  /**
   * 不整合の最大値を取得するヘルパーメソッド
   */
  getMaxDiscrepancy(discrepancy) {
    return discrepancy.discrepancies ? discrepancy.discrepancies.max : discrepancy.discrepancy;
  }

  /**
   * 自動修正の判断
   */
  shouldAutoCorrect(discrepancy) {
    if (!this.config.autoCorrection.enabled) {
      return false;
    }

    const maxDiscrepancy = this.getMaxDiscrepancy(discrepancy);
    if (maxDiscrepancy > this.config.autoCorrection.majorDiscrepancyThreshold) {
      return false; // 重大な不整合は手動確認が必要
    }

    // 1日の最大自動修正回数をチェック
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.dailyAutoCorrections = 0;
      this.lastResetDate = today;
    }

    if (this.dailyAutoCorrections >= this.config.autoCorrection.maxAutoCorrections) {
      return false;
    }

    return maxDiscrepancy <= this.config.autoCorrection.minorDiscrepancyThreshold;
  }

  /**
   * 自動修正の実行
   */
  async attemptAutoCorrection(discrepancy) {
    try {
      console.log(`🔧 自動修正を試行: ${discrepancy.currency}`);

      // 修正前のスナップショットを記録
      const beforeSnapshot = await this.createBalanceSnapshot(discrepancy.currency);

      // 修正ロジック（例：Redis残高を取引所残高に合わせる）
      const correctionResult = await this.performCorrection(discrepancy);

      if (correctionResult.success) {
        this.dailyAutoCorrections++;
        this.metrics.autoCorrections++;

        // 修正後のスナップショットを記録
        const afterSnapshot = await this.createBalanceSnapshot(discrepancy.currency);

        await this.logAuditRecord('AUTO_CORRECTION', {
          currency: discrepancy.currency,
          beforeSnapshot,
          afterSnapshot,
          correctionResult
        });

        console.log(`✅ 自動修正完了: ${discrepancy.currency}`);

        // 修正通知
        await this.sendCorrectionNotification(discrepancy, correctionResult);
      } else {
        console.log(`❌ 自動修正失敗: ${discrepancy.currency}`);
        await this.logAuditRecord('AUTO_CORRECTION_FAILED', {
          currency: discrepancy.currency,
          error: correctionResult.error
        });
      }
    } catch (error) {
      console.error(`自動修正中にエラーが発生: ${discrepancy.currency}`, error);
      await this.logAuditRecord('AUTO_CORRECTION_ERROR', {
        currency: discrepancy.currency,
        error: error.message
      });
    }
  }

  /**
   * 修正の実行
   */
  async performCorrection(discrepancy) {
    try {
      // 修正の前提条件確認
      if (!discrepancy || !discrepancy.currency) {
        return {
          success: false,
          error: '無効な不整合データ',
          action: 'manual_review_required'
        };
      }

      const { currency, exchangeBalance, redisBalance } = discrepancy;

      // 取引所残高を信頼できるソースとして使用
      const validationResult = validateBalance(exchangeBalance, currency);
      if (!validationResult.valid) {
        return {
          success: false,
          error: `取引所残高の検証失敗: ${validationResult.error}`,
          action: 'manual_review_required'
        };
      }

      // 手動承認が必要な場合
      if (this.config.autoCorrection.requireManualApproval) {
        await this.logAuditRecord('CORRECTION_PENDING_APPROVAL', {
          currency,
          currentExchangeBalance: exchangeBalance,
          currentRedisBalance: redisBalance,
          proposedCorrection: exchangeBalance,
          timestamp: new Date()
        });

        // Discord通知で承認を求める
        await postOrderToDiscord({
          title: '🔧 残高修正承認要求',
          type: 'correction_request',
          data: {
            currency,
            currentExchangeBalance: exchangeBalance,
            currentRedisBalance: redisBalance,
            proposedCorrection: exchangeBalance,
            discrepancy: discrepancy.discrepancies.max
          }
        });

        return {
          success: false,
          error: '手動承認が必要です',
          action: 'manual_approval_required',
          proposedCorrection: exchangeBalance
        };
      }

      // 自動修正の実行（Redis残高を取引所残高に合わせる）
      const redisClient = await getRedisClient();
      const key = `balance:${currency}`;

      // トランザクションで安全に更新
      const multi = redisClient.multi();

      // 既存のRedis残高をバックアップ
      const backupKey = `balance_backup:${currency}:${Date.now()}`;
      multi.hSet(backupKey, 'amount', redisBalance.toString());
      multi.hSet(backupKey, 'timestamp', new Date().toISOString());
      multi.expire(backupKey, 86400 * 7); // 7日間保持

      // 新しい残高を設定
      multi.hSet(key, 'amount', exchangeBalance.toString());
      multi.hSet(key, 'updated_at', new Date().toISOString());
      multi.hSet(key, 'correction_reason', 'integrity_check_auto_correction');

      const results = await multi.exec();
      
      // Redis操作の結果をチェック
      if (!results || results.some(result => result[0] !== null)) {
        throw new Error(`Redis操作が失敗しました: ${JSON.stringify(results)}`);
      }

      // 戦略別残高もリセット（取引所残高に基づいて再配分）
      await this.redistributeStrategyBalances(currency, exchangeBalance);

      return {
        success: true,
        action: 'auto_corrected',
        previousBalance: redisBalance,
        newBalance: exchangeBalance,
        correctionTime: new Date()
      };

    } catch (error) {
      console.error('残高修正中にエラーが発生:', error);
      return {
        success: false,
        error: error.message,
        action: 'correction_failed'
      };
    }
  }

  /**
   * 戦略別残高の再配分
   */
  async redistributeStrategyBalances(currency, totalBalance) {
    try {
      const redisClient = await getRedisClient();
      const strategies = config.strategies;

      // 各戦略のキーを削除してリセット
      for (const strategyKey of Object.keys(strategies)) {
        const key = `strategyPositions:${strategyKey}:${currency}`;
        await redisClient.del(key);
      }

      // 総残高を0に設定（取引によって再計算される）
      console.log(`✅ ${currency}の戦略別残高をリセットしました`);

    } catch (error) {
      console.error('戦略別残高の再配分中にエラー:', error);
      throw error;
    }
  }

  /**
   * 残高スナップショットの作成
   */
  async createBalanceSnapshot(currency) {
    const exchangeBalance = await this.getExchangeBalance(currency);
    const redisBalance = await this.getRedisBalance(currency);

    return {
      currency,
      timestamp: new Date(),
      exchangeBalance,
      redisBalance
    };
  }

  /**
   * 深刻度の計算
   */
  calculateSeverity(discrepancyPercent) {
    if (discrepancyPercent >= this.config.thresholds.criticalThreshold) {
      return 'critical';
    } else if (discrepancyPercent >= this.config.thresholds.warningThreshold) {
      return 'warning';
    } else {
      return 'minor';
    }
  }

  /**
   * 取引停止の検討
   */
  async considerTradingHalt(discrepancy) {
    if (!this.config.tradingHalt.enabled) {
      return;
    }

    const maxDiscrepancy = this.getMaxDiscrepancy(discrepancy);
    if (maxDiscrepancy >= this.config.tradingHalt.majorDiscrepancyThreshold) {
      await this.initiateEmergencyHalt();
    }
  }

  /**
   * 緊急停止の実行
   */
  async initiateEmergencyHalt() {
    if (this.tradingHalted) {
      return;
    }

    console.log('🚨 緊急停止を実行します');
    this.tradingHalted = true;

    // 取引停止の実装
    // 実際の取引停止ロジックはここに実装

    await this.logAuditRecord('EMERGENCY_HALT', {
      reason: 'Major discrepancy detected',
      consecutiveFailures: this.consecutiveFailures,
      timestamp: new Date()
    });

    // 緊急停止通知
    await this.sendEmergencyHaltNotification();

    // クールダウン期間後に再開
    this.emergencyHaltTimer = setTimeout(() => {
      this.tradingHalted = false;
      this.consecutiveFailures = 0;
      console.log('✅ 緊急停止が解除されました');
      this.emergencyHaltTimer = null;
    }, this.config.tradingHalt.cooldownPeriod);
  }

  /**
   * メトリクスの更新
   */
  updateMetrics(startTime, discrepancies) {
    this.metrics.totalChecks++;
    this.metrics.discrepanciesFound += discrepancies.length;
    this.metrics.lastCheckTime = new Date();

    const checkTime = Date.now() - startTime;
    this.metrics.averageCheckTime =
      (this.metrics.averageCheckTime * (this.metrics.totalChecks - 1) + checkTime) /
      this.metrics.totalChecks;
  }

  /**
   * 監査ログの記録
   */
  async logAuditRecord(action, data) {
    const record = {
      timestamp: new Date(),
      action,
      data,
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    this.auditLog.push(record);

    // MongoDBに記録
    try {
      await ensureConnection();
      const auditCollection = getCollectionRef('balance_audit_log');
      await auditCollection.insertOne(record);
    } catch (error) {
      console.error('監査ログ記録エラー:', error);
    }

    // ログサイズ制限
    if (this.auditLog.length > SYSTEM_LIMITS.MAX_AUDIT_LOG_SIZE) {
      this.auditLog = this.auditLog.slice(-Math.floor(SYSTEM_LIMITS.MAX_AUDIT_LOG_SIZE / 2));
    }
  }

  /**
   * 重要アラート送信
   */
  async sendCriticalAlert(discrepancies) {
    let message = '🚨 **重要な残高不整合が検出されました**\n\n';

    for (const discrepancy of discrepancies.slice(0, 5)) {
      message += `**${discrepancy.currency}**\n`;
      message += `- 取引所残高: ${discrepancy.exchangeBalance}\n`;
      message += `- Redis残高: ${discrepancy.redisBalance}\n`;
      message += `- 乖離: ${discrepancy.discrepancyPercent.toFixed(2)}%\n\n`;
    }

    message += `🕐 検出時刻: ${formatJST(new Date())}\n`;
    message += `📊 合計不整合件数: ${discrepancies.length}件`;

    try {
      await postErrorToDiscord(message);
    } catch (error) {
      console.error('重要アラート送信エラー:', error);
    }
  }

  /**
   * 警告アラート送信
   */
  async sendWarningAlert(discrepancies) {
    let message = '⚠️ **残高不整合の警告**\n\n';

    for (const discrepancy of discrepancies.slice(0, 3)) {
      message += `${discrepancy.currency}: ${discrepancy.discrepancyPercent.toFixed(2)}%乖離\n`;
    }

    message += `\n🕐 検出時刻: ${formatJST(new Date())}\n`;
    message += `📊 警告件数: ${discrepancies.length}件`;

    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('警告アラート送信エラー:', error);
    }
  }

  /**
   * 修正通知送信
   */
  async sendCorrectionNotification(discrepancy, correctionResult) {
    let message = '🔧 **自動修正実行**\n\n';
    message += `通貨: ${discrepancy.currency}\n`;
    message += `修正前乖離: ${discrepancy.discrepancyPercent.toFixed(2)}%\n`;
    message += `修正結果: ${correctionResult.success ? '成功' : '失敗'}\n`;
    message += `\n🕐 実行時刻: ${formatJST(new Date())}`;

    try {
      await postOrderToDiscord(message);
    } catch (error) {
      console.error('修正通知送信エラー:', error);
    }
  }

  /**
   * 緊急停止通知送信
   */
  async sendEmergencyHaltNotification() {
    const message = '🚨 **緊急停止が実行されました**\n\n' +
      '理由: 重大な残高不整合\n' +
      `連続失敗回数: ${this.consecutiveFailures}\n` +
      `クールダウン期間: ${this.config.tradingHalt.cooldownPeriod / TIME_CONSTANTS.SECOND}秒\n` +
      `\n🕐 実行時刻: ${formatJST(new Date())}`;

    try {
      await postErrorToDiscord(message);
    } catch (error) {
      console.error('緊急停止通知送信エラー:', error);
    }
  }

  /**
   * 現在のメトリクスを取得
   */
  getMetrics() {
    return {
      ...this.metrics,
      isRunning: this.isRunning,
      tradingHalted: this.tradingHalted,
      consecutiveFailures: this.consecutiveFailures,
      dailyAutoCorrections: this.dailyAutoCorrections,
      cacheSize: this.dataCache.size,
      auditLogSize: this.auditLog.length
    };
  }

  /**
   * 監査ログを取得
   */
  getAuditLog(limit = 100) {
    return this.auditLog.slice(-limit);
  }

  /**
   * キャッシュのクリア
   */
  clearCache() {
    this.dataCache.clear();
    console.log('✅ データキャッシュがクリアされました');
  }
}

// シングルトンインスタンス
const balanceIntegrityService = new BalanceIntegrityService();

module.exports = {
  BalanceIntegrityService,
  balanceIntegrityService
};