# SQLiteからRedisへの移行計画

## 1. データモデルの設計

現在SQLiteをデータベースとして使っているが、Redisに変えます。


### 現在のSQLiteデータモデル
- `trade_records` テーブル: 取引所、通貨ペア、戦略ごとの集計情報
- `trade_history` テーブル: 個々の取引履歴(注文履歴)

### 提案するRedisデータモデル

```mermaid
graph TD
    A[Redis データモデル] --> B[取引記録]
    A --> C[注文履歴]
    A --> D[約定履歴]
    A --> E[インデックス]
    A --> F[トレードペア]
 
    
    B --> B1[Hash: trade:record:{exchangeId}:{symbol}:{strategyKey}]
    B1 --> B1a[buyAmount, sellAmount, totalBuyCost, totalSellValue, netPosition, createdAt, updatedAt]
    
    C --> C1[List: trade:orderHistory:{exchangeId}:{symbol}:{strategyKey}]
    C1 --> C1a[orderId, amount, side, price, orderType, orderAt]

    D --> D1[List: trade:filledHistory:{exchangeId}:{symbol}:{strategyKey}]
    D1 --> D1a[orderId, amount, side, price, orderType, fee, filledAt] 

    F --> F1[Hash: trade:pair:{exchangeId}:{symbol}:{strategyKey}:{pairId}]
    F1 --> F1a[amount, side, filledOrderId, price, canceledAt, createdAt, filledAt]

    E --> E1[Set: exchanges]
    E --> E2[Set: symbols:{exchangeId}]
    E --> E3[Set: strategies:{exchangeId}:{symbol}]
    E --> E4[Sorted Set: trade:orderHistory:time]
    E --> E5[Sorted Set: trade:filledHistory:time]
    E --> E6[Sorted Set: trade:pairs:time:{exchangeId}:{symbol}:{strategyKey}]
    E --> E7[Sorted Set: trade:record:time]
    E4 --> E4a[スコア: タイムスタンプ, メンバー: 取引ID]
    E5 --> E5a[スコア: タイムスタンプ, メンバー: 取引ID]
    E5 --> E5a[スコア: タイムスタンプ, メンバー: 取引ID]
    E6 --> E6a[スコア: タイムスタンプ, メンバー: pairId]
    E7 --> E7a[スコア: タイムスタンプ, メンバー: exchangeId]
```

#### 1. 取引記録（trade_records）
- **ハッシュ構造**を使用: `trade:record:{exchangeId}:{symbol}:{strategyKey}`
  - フィールド: `buyAmount`, `sellAmount`, `totalBuyCost`, `totalSellValue`, `netPosition`, `updatedAt` など
  - 例: `trade:record:binance:BTC/USDT:trendFollowing`

#### 2. 取引履歴
a. 注文履歴（trade:orderHistory）  
- **リスト構造**を使用: `trade:orderHistory:{exchangeId}:{symbol}:{strategyKey}`  
  - 例: `trade:orderHistory:binance:BTC/USDT:trendFollowing`

b. 約定履歴（trade:filledHistory）  
- **リスト構造**を使用: `trade:filledHistory:{exchangeId}:{symbol}:{strategyKey}`  
  - 例: `trade:filledHistory:binance:BTC/USDT:trendFollowing`

#### 3. トレードペア（trade:pair）
- **ハッシュ構造**を使用: `trade:pair:{exchangeId}:{symbol}:{strategyKey}:{pairId}`
  - フィールド: 
    - `buyOrderId`: 買い注文のID
    - `sellOrderId`: 売り注文のID
    - `filledOrderId`: 約定した注文のID（存在すれば約定済みと判断）
    - `buyPrice`: 買い価格
    - `sellPrice`: 売り価格
    - `amount`: 数量
    - `createdAt`: 作成日時
    - `updatedAt`: 更新日時
  - 例: `trade:pair:binance:BTC/USDT:trendFollowing:1234567890`

#### 4. インデックス（検索効率化のため）
- **セット構造**を使用:
  - 取引所一覧: `exchanges` (Set)
  - 通貨ペア一覧: `symbols:{exchangeId}` (Set)
  - 戦略一覧: `strategies:{exchangeId}:{symbol}` (Set)
- **ソート済みセット**を使用:
  - 時系列インデックス: `trade:orderHistory:time` (スコア: タイムスタンプ, メンバー: 取引ID)
  - 時系列インデックス: `trade:filledHistory:time` (スコア: タイムスタンプ, メンバー: 取引ID)
  - トレードペア時系列インデックス: `trade:pairs:time:{exchangeId}:{symbol}:{strategyKey}` (スコア: タイムスタンプ, メンバー: pairId)

## 2. 実装計画

### フェーズ1: Redis接続とヘルパー関数の実装

1. Redis依存関係の追加
   ```bash
   npm install redis
   ```

2. Redis接続モジュールの作成 (`src/redisClient.js`)
   - Redis接続の設定
   - 永続化オプションの設定（RDB）
   - 接続エラー処理

3. データアクセスヘルパー関数の実装
   - 取引記録の追加/更新
   - 取引履歴の追加
   - 取引記録の取得
   - 取引履歴の取得
   - インデックスの管理

### フェーズ2: 新しいデータベースモジュールの実装

1. `src/redisDatabase.js`の作成
   - 現在の`database.js`と同様のインターフェースを提供
   - Redisデータモデルを使用した実装

2. `src/tradeRecords.js`の新バージョン作成
   - Redisクライアントを使用するように実装
   - キャッシュ戦略の見直し（Redisがすでにインメモリなので、追加のキャッシュが不要かもしれない）

### フェーズ3: APIコントローラーの実装

1. `src/api/controllers/`内の各コントローラーの新バージョン作成
   - SQLクエリの代わりにRedisコマンドを使用
   - 必要に応じてデータ取得ロジックを最適化

2. `src/api/database-events.js`の新バージョン作成
   - RedisのPub/Sub機能を使用してイベント通知を実装
   - ポーリングベースの監視からリアルタイム通知に移行

### フェーズ5: Docker環境でのRedisデプロイメント

1. Docker Compose構成の作成
   ```yaml
   version: '3'
   
   services:
     redis:
       image: redis:7-alpine
       container_name: harvest3-redis
       command: redis-server --appendonly yes
       ports:
         - "6379:6379"
       volumes:
         - redis_data:/data
       restart: always
       networks:
         - harvest-network
   
     # 既存の戦略・アプリケーションサービスの例
     strategy-service:
       build:
         context: .
         dockerfile: Dockerfile
       environment:
         - REDIS_URL=redis://redis:6379
       depends_on:
         - redis
       networks:
         - harvest-network
   
   networks:
     harvest-network:
       driver: bridge
   
   volumes:
     redis_data:
       driver: local
   ```

2. Redisクライアント設定の更新
   - 環境変数を使用して接続先を設定可能に
   - Docker環境と開発環境で同じコードベースが動作するように設計
   
   ```javascript
   // src/redisClient.js の例
   const redis = require('redis');
   
   const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
   
   const client = redis.createClient({
     url: REDIS_URL
   });
   
   // 接続処理
   ```

3. Docker環境での永続化設定
   - AOF (Append Only File) モード有効化
   - ボリュームマウントによるデータ永続化
   - バックアップ戦略（コンテナ外へのデータエクスポート）

4. コンテナ間通信
   - Docker ネットワーク "harvest-network" を使用
   - サービス間では `redis` ホスト名で接続可能
   - 外部からのアクセスはポートマッピング (`6379:6379`) を使用

5. スケーリング考慮事項
   - 複数の戦略プロセスから単一のRedisサーバーへの接続
   - コネクションプールの設定
   - 負荷が高い場合はRedisクラスタへの移行も検討

6. セキュリティ対策
   - 本番環境ではRedis認証の有効化
   - ファイアウォール設定でのアクセス制限
   - 機密データの暗号化検討