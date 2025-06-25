# 包括的資産同期アーキテクチャ設計書

## 問題の本質

### 現在の課題
1. **3層データ不整合**: Redis (リアルタイム) ⟷ MongoDB (履歴) ⟷ 取引所API (真実)
2. **非同期処理の複雑性**: ネットワーク遅延、API制限、エラー時の状態不整合
3. **イベント順序保証の欠如**: 部分約定、キャンセル、手動取引の処理順序問題
4. **障害復旧の不完全性**: システム再起動時の状態復元失敗

## 設計思想: Event-Driven Reconciliation Architecture

### コア原則
1. **Single Source of Truth**: 取引所APIを最終的な真実の源泉とする
2. **Eventually Consistent**: 最終的整合性を保証する自己修復システム
3. **Idempotent Operations**: 冪等性を持つ操作設計
4. **Audit Trail**: 全ての状態変更を追跡可能にする

## アーキテクチャ設計

### 1. Event Sourcing + CQRS パターン

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Command Side  │    │   Event Store   │    │   Query Side    │
│                 │    │                 │    │                 │
│ • Trade Orders  │───▶│ • OrderPlaced   │───▶│ • Redis Cache   │
│ • Cancellations │    │ • OrderFilled   │    │ • MongoDB Views │
│ • Manual Trades │    │ • OrderCanceled │    │ • Balance Views │
└─────────────────┘    │ • BalanceAdjust │    └─────────────────┘
                       └─────────────────┘
```

#### Event Types
```typescript
interface TradingEvent {
  eventId: string;
  timestamp: number;
  eventType: 'OrderPlaced' | 'OrderFilled' | 'OrderCanceled' | 'BalanceReconciled' | 'ManualTradeDetected';
  aggregateId: string; // symbol + strategy
  version: number;
  data: any;
  metadata: {
    source: 'bot' | 'exchange_api' | 'manual_detection';
    correlationId: string;
  };
}
```

### 2. Saga Pattern による複雑な取引フロー管理

```
OrderSaga: 
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ PlaceOrder  │───▶│ ConfirmFill │───▶│ UpdateCache │───▶│ Complete    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Compensate  │    │ Retry       │    │ Reconcile   │
└─────────────┘    └─────────────┘    └─────────────┘
```

### 3. 自己修復型の継続的同期システム

#### 3.1 リアルタイム同期層
```javascript
class RealTimeSyncService {
  async processTradeEvent(event) {
    try {
      // 1. Event Store に記録
      await this.eventStore.append(event);
      
      // 2. 投影の更新
      await this.updateProjections(event);
      
      // 3. 整合性検証
      await this.verifyConsistency(event.aggregateId);
      
    } catch (error) {
      // 補償トランザクション
      await this.initiateCompensation(event);
    }
  }
}
```

#### 3.2 バッチ同期層
```javascript
class BatchReconciliationService {
  async performFullReconciliation() {
    // 1. 取引所から全資産情報取得
    const exchangeAssets = await this.fetchExchangeAssets();
    
    // 2. Bot管理資産の再計算
    const botAssets = await this.recalculateBotAssets();
    
    // 3. 差異の検出と分析
    const discrepancies = this.detectDiscrepancies(exchangeAssets, botAssets);
    
    // 4. 自動修復または手動確認要求
    for (const discrepancy of discrepancies) {
      if (discrepancy.autoRepairable) {
        await this.autoRepair(discrepancy);
      } else {
        await this.requestManualReview(discrepancy);
      }
    }
  }
}
```

### 4. 分散トランザクション管理

#### 4.1 2-Phase Commit for Critical Operations
```javascript
class DistributedTransactionManager {
  async executeTrade(tradeCommand) {
    const transaction = new DistributedTransaction();
    
    try {
      // Phase 1: Prepare
      await transaction.prepare([
        () => this.exchangeAPI.validateOrder(tradeCommand),
        () => this.cache.reserveBalance(tradeCommand),
        () => this.eventStore.validateSequence(tradeCommand)
      ]);
      
      // Phase 2: Commit
      await transaction.commit([
        () => this.exchangeAPI.placeOrder(tradeCommand),
        () => this.cache.updateBalance(tradeCommand),
        () => this.eventStore.appendEvent(tradeCommand)
      ]);
      
    } catch (error) {
      // Rollback
      await transaction.rollback();
      throw error;
    }
  }
}
```

### 5. 外部取引検出・統合システム

#### 5.1 取引所監視サービス
```javascript
class ExternalTradeDetector {
  async detectExternalTrades() {
    // 1. 最新の取引履歴を取得
    const recentTrades = await this.fetchRecentTrades();
    
    // 2. Bot管理取引との照合
    const externalTrades = recentTrades.filter(trade => 
      !this.botTradeRegistry.has(trade.orderId)
    );
    
    // 3. 外部取引イベントの生成
    for (const trade of externalTrades) {
      await this.eventStore.append({
        eventType: 'ExternalTradeDetected',
        data: trade,
        metadata: { source: 'external_detection' }
      });
    }
  }
}
```

### 6. 障害復旧・状態復元システム

#### 6.1 Event Replay による状態復元
```javascript
class StateRecoveryService {
  async recoverFromLastSnapshot() {
    // 1. 最新のスナップショットを取得
    const snapshot = await this.snapshotStore.getLatest();
    
    // 2. スナップショット以降のイベントを再生
    const events = await this.eventStore.getEventsAfter(snapshot.version);
    
    // 3. 状態の再構築
    let state = snapshot.data;
    for (const event of events) {
      state = this.applyEvent(state, event);
    }
    
    // 4. 取引所との最終整合性チェック
    await this.performConsistencyCheck(state);
    
    return state;
  }
}
```

### 7. 監視・アラートシステム

#### 7.1 リアルタイム異常検知
```javascript
class ConsistencyMonitor {
  constructor() {
    this.metrics = new MetricsCollector();
    this.alertManager = new AlertManager();
  }
  
  async checkConsistency() {
    const consistency = await this.calculateConsistencyScore();
    
    if (consistency.score < 0.95) {
      await this.alertManager.sendAlert({
        level: 'CRITICAL',
        message: `Consistency score dropped to ${consistency.score}`,
        details: consistency.issues
      });
    }
  }
}
```

## 実装戦略

### Phase 1: 基盤構築 (2週間)
1. Event Store の実装
2. 基本的な Event Sourcing インフラ
3. CQRS パターンの導入

### Phase 2: 同期システム (3週間)
1. リアルタイム同期サービス
2. バッチ同期サービス
3. 外部取引検出システム

### Phase 3: 自己修復・監視 (2週間)
1. 自動修復ロジック
2. 状態復旧システム
3. 包括的監視ダッシュボード

### Phase 4: 最適化・テスト (1週間)
1. パフォーマンス最適化
2. 障害シナリオテスト
3. 本番環境デプロイ

## 期待効果

1. **完全性**: 99.99%以上の資産同期精度
2. **可用性**: システム障害時も自動復旧
3. **透明性**: 全ての状態変更が追跡可能
4. **スケーラビリティ**: 取引量増加に対応
5. **信頼性**: 金融グレードの堅牢性

## 技術スタック

- **Event Store**: EventStore DB または Apache Kafka
- **Database**: Redis (Cache) + MongoDB (Projection)
- **Message Queue**: RabbitMQ または Apache Kafka
- **Monitoring**: Prometheus + Grafana
- **Alerting**: Discord WebHooks + PagerDuty

この設計により、取引所とBotの完全な資産同期を実現し、自己修復能力を持つ信頼性の高いシステムが構築できます。