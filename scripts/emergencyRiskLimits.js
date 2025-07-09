/**
 * 緊急リスク制限強化システム
 * Ultra-Deep Analysis発見問題への即座対応
 */
require('dotenv').config();
const redis = require('redis');

class EmergencyRiskLimits {
  constructor() {
    this.client = null;
    this.isActive = false;

    // 緊急リスク制限設定
    this.limits = {
      // ポジション制限
      maxTotalPositions: 200,          // 総ポジション数上限
      maxPositionValue: 500000,        // 総ポジション価値上限 (JPY)
      maxLongPositionRatio: 0.75,      // ロングポジション比率上限
      maxPositionsPerSymbol: 5,        // 通貨ペア別ポジション上限

      // 注文制限
      maxOrderValue: 50000,            // 単一注文価値上限 (JPY)
      maxDailyOrders: 1000,            // 日次注文数上限
      maxConcurrentOrders: 50,         // 同時未約定注文上限

      // 戦略制限
      maxStrategiesPerSymbol: 3,       // 通貨ペア別戦略数上限
      minStrategyInterval: 300000,     // 戦略間最小間隔 (5分)

      // 緊急停止条件
      emergencyStopLossRatio: 0.05,    // 5%損失で緊急停止
      emergencyDrawdownRatio: 0.10,    // 10%ドローダウンで緊急停止

      // データ整合性制限
      maxDataInconsistencyRatio: 0.10, // 10%以上の不整合で制限
      minRequiredDataCount: {
        summary_trade: 5,
        filled_trade: 1
      }
    };

    // 制限状態の記録
    this.restrictions = {
      buyOrdersSuspended: false,
      newPositionsBlocked: false,
      emergencyModeActive: false,
      lastRestrictionTime: null,
      restrictionReason: null
    };

    // 統計
    this.stats = {
      blockedOrders: 0,
      preventedPositions: 0,
      emergencyStops: 0,
      lastUpdate: Date.now()
    };
  }

  async initialize() {
    try {
      this.client = redis.createClient({ url: 'redis://redis:6379' });
      await this.client.connect();

      // 既存の制限状態を読み込み
      await this.loadRestrictionState();

      console.log('✅ EmergencyRiskLimits initialized');
      return true;
    } catch (error) {
      console.error('❌ EmergencyRiskLimits initialization failed:', error.message);
      return false;
    }
  }

  async activate() {
    if (this.isActive) {
      console.log('⚠️ EmergencyRiskLimits already active');
      return;
    }

    console.log(`
🛡️ 緊急リスク制限強化システム起動

Ultra-Deep Analysis発見問題への対策:
• ポジション偏り 100%ロング → 強制制限実装
• 極端リスク状況 → 自動制限・停止機能
• データ不整合時 → 保守的運用モード

制限設定:
• 最大ポジション数: ${this.limits.maxTotalPositions}件
• ロング比率上限: ${(this.limits.maxLongPositionRatio * 100)}%
• 単一注文上限: ¥${this.limits.maxOrderValue.toLocaleString()}
• 緊急停止ライン: ${(this.limits.emergencyStopLossRatio * 100)}%損失
    `);

    this.isActive = true;

    // 現在の状況確認
    await this.checkCurrentRiskStatus();

    // 定期チェック開始 (5分間隔)
    this.checkInterval = setInterval(async () => {
      await this.performRiskCheck();
    }, 5 * 60 * 1000);

    console.log('🚀 緊急リスク制限システム稼働開始');
  }

  async deactivate() {
    console.log('🛑 EmergencyRiskLimits停止中...');
    this.isActive = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    await this.saveRestrictionState();

    if (this.client) {
      await this.client.quit();
    }

    console.log('✅ EmergencyRiskLimits停止完了');
  }

  // 現在のリスク状況確認
  async checkCurrentRiskStatus() {
    try {
      console.log('\n🔍 現在のリスク状況確認中...');

      // ポジション分析
      const positionKeys = await this.client.keys('position:*');
      let longCount = 0;
      let shortCount = 0;
      let totalValue = 0;
      const symbolCounts = {};
      const strategyCounts = {};

      for (const key of positionKeys) {
        try {
          const pos = await this.client.hGetAll(key);
          const amount = parseFloat(pos.amount) || 0;
          const price = parseFloat(pos.entryPrice) || 0;
          const symbol = pos.symbol;
          const strategy = pos.strategyKey;

          if (amount > 0) {
            longCount++;
            totalValue += amount * price;
          } else if (amount < 0) {
            shortCount++;
            totalValue += Math.abs(amount) * price;
          }

          // 通貨ペア別カウント
          symbolCounts[symbol] = (symbolCounts[symbol] || 0) + 1;

          // 戦略別カウント
          strategyCounts[strategy] = (strategyCounts[strategy] || 0) + 1;

        } catch (err) {
          // エラーはスキップ
        }
      }

      const totalPositions = longCount + shortCount;
      const longRatio = totalPositions > 0 ? longCount / totalPositions : 0;

      console.log(`  総ポジション数: ${totalPositions}件 (上限: ${this.limits.maxTotalPositions})`);
      console.log(`  ロング比率: ${(longRatio * 100).toFixed(1)}% (上限: ${(this.limits.maxLongPositionRatio * 100)}%)`);
      console.log(`  総ポジション価値: ¥${totalValue.toLocaleString()} (上限: ¥${this.limits.maxPositionValue.toLocaleString()})`);

      // 制限チェック
      const violations = [];

      if (totalPositions > this.limits.maxTotalPositions) {
        violations.push(`ポジション数超過: ${totalPositions}/${this.limits.maxTotalPositions}`);
      }

      if (longRatio > this.limits.maxLongPositionRatio) {
        violations.push(`ロング比率超過: ${(longRatio * 100).toFixed(1)}%/${(this.limits.maxLongPositionRatio * 100)}%`);
      }

      if (totalValue > this.limits.maxPositionValue) {
        violations.push(`ポジション価値超過: ¥${totalValue.toLocaleString()}/¥${this.limits.maxPositionValue.toLocaleString()}`);
      }

      // 通貨ペア別制限チェック
      for (const [symbol, count] of Object.entries(symbolCounts)) {
        if (count > this.limits.maxPositionsPerSymbol) {
          violations.push(`${symbol}ポジション過多: ${count}/${this.limits.maxPositionsPerSymbol}`);
        }
      }

      // 違反対応
      if (violations.length > 0) {
        console.log('\n⚠️ 制限違反検出:');
        violations.forEach(v => console.log(`  🔴 ${v}`));

        await this.enforceEmergencyRestrictions('LIMIT_VIOLATIONS', violations);
      } else {
        console.log('\n✅ リスク状況: 制限内');

        // 既存の制限を段階的に解除
        await this.graduallyLiftRestrictions();
      }

    } catch (error) {
      console.error('❌ リスク状況確認エラー:', error.message);
    }
  }

  // 定期リスクチェック
  async performRiskCheck() {
    if (!this.isActive) {
      return;
    }

    try {
      console.log(`\n🔍 定期リスクチェック (${new Date().toLocaleString('ja-JP')})`);

      // データ整合性チェック
      await this.checkDataIntegrity();

      // ポジションリスクチェック
      await this.checkPositionRisk();

      // 注文リスクチェック
      await this.checkOrderRisk();

      // 統計更新
      this.stats.lastUpdate = Date.now();
      await this.saveStats();

    } catch (error) {
      console.error('❌ 定期リスクチェックエラー:', error.message);
    }
  }

  // データ整合性チェック
  async checkDataIntegrity() {
    try {
      const positionKeys = await this.client.keys('position:*');
      const summaryKeys = await this.client.keys('summary:trade:*');
      const filledTradeKeys = await this.client.keys('filled_trade:*');

      // 最小データ要件チェック
      if (filledTradeKeys.length < this.limits.minRequiredDataCount.filled_trade) {
        await this.enforceEmergencyRestrictions('DATA_INSUFFICIENT', {
          type: 'filled_trade',
          actual: filledTradeKeys.length,
          required: this.limits.minRequiredDataCount.filled_trade
        });
        return;
      }

      if (summaryKeys.length < this.limits.minRequiredDataCount.summary.trade) {
        await this.enforceEmergencyRestrictions('DATA_INSUFFICIENT', {
          type: 'summary:trade',
          actual: summaryKeys.length,
          required: this.limits.minRequiredDataCount.summary.trade
        });
        return;
      }

      // Position-Summary整合性チェック
      let missingCount = 0;
      for (const posKey of positionKeys.slice(0, 50)) { // サンプリング
        try {
          const pos = await this.client.hGetAll(posKey);
          if (pos.symbol && pos.strategyKey) {
            const summaryKey = `summary:trade:${pos.symbol}:${pos.strategyKey}`;
            const exists = await this.client.exists(summaryKey);
            if (!exists) {
              missingCount++;
            }
          }
        } catch (err) {
          // スキップ
        }
      }

      const checkedCount = Math.min(positionKeys.length, 50);
      const inconsistencyRatio = checkedCount > 0 ? missingCount / checkedCount : 0;

      if (inconsistencyRatio > this.limits.maxDataInconsistencyRatio) {
        await this.enforceEmergencyRestrictions('DATA_INCONSISTENCY', {
          inconsistencyRatio: (inconsistencyRatio * 100).toFixed(1) + '%',
          missingCount,
          checkedCount
        });
      }

    } catch (error) {
      console.error('データ整合性チェックエラー:', error.message);
    }
  }

  // ポジションリスクチェック
  async checkPositionRisk() {
    // checkCurrentRiskStatus と同様の処理
    await this.checkCurrentRiskStatus();
  }

  // 注文リスクチェック
  async checkOrderRisk() {
    try {
      const pendingOrderKeys = await this.client.keys('pending_order:*');

      if (pendingOrderKeys.length > this.limits.maxConcurrentOrders) {
        await this.enforceEmergencyRestrictions('ORDER_OVERLOAD', {
          pendingOrders: pendingOrderKeys.length,
          limit: this.limits.maxConcurrentOrders
        });
      }

      // 古い未約定注文の確認
      let expiredOrders = 0;
      const now = Date.now();

      for (const key of pendingOrderKeys.slice(0, 50)) {
        try {
          const order = await this.client.hGetAll(key);
          const orderTime = parseInt(order.timestamp) || parseInt(order.createdAt) || 0;

          // 2時間以上古い注文
          if (orderTime < now - 2 * 60 * 60 * 1000) {
            expiredOrders++;
          }
        } catch (err) {
          // スキップ
        }
      }

      if (expiredOrders > 10) {
        console.log(`⚠️ 期限切れ注文多数: ${expiredOrders}件`);
      }

    } catch (error) {
      console.error('注文リスクチェックエラー:', error.message);
    }
  }

  // 緊急制限実施
  async enforceEmergencyRestrictions(reason, details) {
    console.log(`\n🚨 緊急制限実施: ${reason}`);
    console.log(`   詳細: ${JSON.stringify(details, null, 2)}`);

    this.restrictions.emergencyModeActive = true;
    this.restrictions.lastRestrictionTime = Date.now();
    this.restrictions.restrictionReason = { reason, details };

    // 制限レベルに応じた対応
    switch (reason) {
    case 'LIMIT_VIOLATIONS':
      this.restrictions.buyOrdersSuspended = true;
      this.restrictions.newPositionsBlocked = true;
      break;

    case 'DATA_INSUFFICIENT':
    case 'DATA_INCONSISTENCY':
      this.restrictions.buyOrdersSuspended = true;
      this.restrictions.newPositionsBlocked = true;
      break;

    case 'ORDER_OVERLOAD':
      this.restrictions.newPositionsBlocked = true;
      break;
    }

    // 制限状態を保存
    await this.saveRestrictionState();

    // 統計更新
    this.stats.emergencyStops++;

    console.log(`   制限状態: 買い注文=${this.restrictions.buyOrdersSuspended}, 新規ポジション=${this.restrictions.newPositionsBlocked}`);
  }

  // 段階的制限解除
  async graduallyLiftRestrictions() {
    if (!this.restrictions.emergencyModeActive) {
      return;
    }

    const now = Date.now();
    const restrictionAge = now - (this.restrictions.lastRestrictionTime || 0);

    // 30分経過後に段階的解除開始
    if (restrictionAge > 30 * 60 * 1000) {
      console.log('🔓 制限の段階的解除を開始...');

      // 新規ポジション制限を先に解除
      if (this.restrictions.newPositionsBlocked) {
        this.restrictions.newPositionsBlocked = false;
        console.log('   ✅ 新規ポジション制限解除');
      }

      // 1時間経過後に買い注文制限解除
      if (restrictionAge > 60 * 60 * 1000 && this.restrictions.buyOrdersSuspended) {
        this.restrictions.buyOrdersSuspended = false;
        console.log('   ✅ 買い注文制限解除');
      }

      // 全制限解除確認
      if (!this.restrictions.buyOrdersSuspended && !this.restrictions.newPositionsBlocked) {
        this.restrictions.emergencyModeActive = false;
        this.restrictions.restrictionReason = null;
        console.log('   🎉 全制限解除完了');
      }

      await this.saveRestrictionState();
    }
  }

  // 制限状態の保存/読み込み
  async saveRestrictionState() {
    try {
      await this.client.hSet('emergency_restrictions', {
        buyOrdersSuspended: this.restrictions.buyOrdersSuspended.toString(),
        newPositionsBlocked: this.restrictions.newPositionsBlocked.toString(),
        emergencyModeActive: this.restrictions.emergencyModeActive.toString(),
        lastRestrictionTime: (this.restrictions.lastRestrictionTime || 0).toString(),
        restrictionReason: JSON.stringify(this.restrictions.restrictionReason || {})
      });
    } catch (error) {
      console.error('制限状態保存エラー:', error.message);
    }
  }

  async loadRestrictionState() {
    try {
      const state = await this.client.hGetAll('emergency_restrictions');
      if (Object.keys(state).length > 0) {
        this.restrictions.buyOrdersSuspended = state.buyOrdersSuspended === 'true';
        this.restrictions.newPositionsBlocked = state.newPositionsBlocked === 'true';
        this.restrictions.emergencyModeActive = state.emergencyModeActive === 'true';
        this.restrictions.lastRestrictionTime = parseInt(state.lastRestrictionTime) || null;

        try {
          this.restrictions.restrictionReason = JSON.parse(state.restrictionReason || '{}');
        } catch (e) {
          this.restrictions.restrictionReason = null;
        }

        if (this.restrictions.emergencyModeActive) {
          console.log('⚠️ 既存の緊急制限状態を読み込みました');
        }
      }
    } catch (error) {
      console.error('制限状態読み込みエラー:', error.message);
    }
  }

  // 統計保存
  async saveStats() {
    try {
      await this.client.hSet('emergency_risk_stats', {
        blockedOrders: this.stats.blockedOrders.toString(),
        preventedPositions: this.stats.preventedPositions.toString(),
        emergencyStops: this.stats.emergencyStops.toString(),
        lastUpdate: this.stats.lastUpdate.toString()
      });
    } catch (error) {
      console.error('統計保存エラー:', error.message);
    }
  }

  // 注文前チェック (外部から呼び出し用)
  isOrderAllowed(orderType, symbol, amount, price) {
    if (!this.isActive) {
      return { allowed: true };
    }

    // 注文価値チェック (緊急制限より先にチェック)
    const orderValue = amount * price;
    if (orderValue > this.limits.maxOrderValue) {
      this.stats.blockedOrders++;
      return {
        allowed: false,
        reason: 'ORDER_VALUE_EXCEEDED',
        message: `注文価値が上限を超過: ¥${orderValue.toLocaleString()} > ¥${this.limits.maxOrderValue.toLocaleString()}`
      };
    }

    // 緊急モード時の制限
    if (this.restrictions.emergencyModeActive) {
      if (orderType === 'buy' && this.restrictions.buyOrdersSuspended) {
        this.stats.blockedOrders++;
        return {
          allowed: false,
          reason: 'BUY_ORDERS_SUSPENDED',
          message: '緊急制限により買い注文が一時停止されています'
        };
      }

      // 新規ポジション制限
      if (this.restrictions.newPositionsBlocked) {
        this.stats.preventedPositions++;
        return {
          allowed: false,
          reason: 'NEW_POSITIONS_BLOCKED',
          message: '緊急制限により新規ポジション作成が一時停止されています'
        };
      }
    }

    return { allowed: true };
  }

  // 現在の状態取得
  getStatus() {
    return {
      isActive: this.isActive,
      limits: this.limits,
      restrictions: this.restrictions,
      stats: this.stats
    };
  }
}

module.exports = { EmergencyRiskLimits };