# SQLiteからRedisへの移行計画

## 1. データモデルの設計

現在のSQLiteのデータモデルをRedisのデータ構造に変換します。

### 現在のSQLiteデータモデル
- `trade_records` テーブル: 取引所、通貨ペア、戦略ごとの集計情報
- `trade_history` テーブル: 個々の取引履歴

### 提案するRedisデータモデル

```mermaid
graph TD
    A[Redis データモデル] --> B[取引記録]
    A --> C[取引履歴]
    A --> D[インデックス]
    
    B --> B1[Hash: trade:record:{exchangeId}:{symbol}:{strategyKey}]
    B1 --> B1a[buyAmount, sellAmount, totalBuyCost, totalSellValue, netPosition, etc.]
    
    C --> C1[List: trade:history:{exchangeId}:{symbol}:{strategyKey}]
    C1 --> C1a[取引履歴エントリ（JSON文字列）]
    
    D --> D1[Set: exchanges]
    D --> D2[Set: symbols:{exchangeId}]
    D --> D3[Set: strategies:{exchangeId}:{symbol}]
    D --> D4[Sorted Set: trade:history:time]
    D4 --> D4a[スコア: タイムスタンプ, メンバー: 取引ID]
```

#### 1. 取引記録（trade_records）
- **ハッシュ構造**を使用: `trade:record:{exchangeId}:{symbol}:{strategyKey}`
  - フィールド: `buyAmount`, `sellAmount`, `totalBuyCost`, `totalSellValue`, `netPosition`, `updatedAt` など
  - 例: `trade:record:binance:BTC/USDT:trendFollowing`

#### 2. 取引履歴（trade_history）
- **リスト構造**を使用: `trade:history:{exchangeId}:{symbol}:{strategyKey}`
  - 各エントリは取引情報のJSON文字列
  - 例: `trade:history:binance:BTC/USDT:trendFollowing`

#### 3. インデックス（検索効率化のため）
- **セット構造**を使用:
  - 取引所一覧: `exchanges` (Set)
  - 通貨ペア一覧: `symbols:{exchangeId}` (Set)
  - 戦略一覧: `strategies:{exchangeId}:{symbol}` (Set)
- **ソート済みセット**を使用:
  - 時系列インデックス: `trade:history:time` (スコア: タイムスタンプ, メンバー: 取引ID)

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

### フェーズ4: テストと展開

1. 単体テストの作成と実行
2. 統合テストの実施
3. 段階的な展開（まずはテスト環境、次に本番環境）
4. モニタリングとパフォーマンス評価

## 3. 技術的な考慮事項

### パフォーマンス最適化
- 頻繁にアクセスされるデータ（最新のポジション情報）に対して効率的なアクセスパターンを設計
- 複雑な集計クエリに対してはRedisのパイプライン機能を活用

### データ整合性
- トランザクション的な操作にはRedisのMULTI/EXECコマンドを使用
- 重要な更新操作にはLuaスクリプトを検討（アトミック性を確保）

### スケーラビリティ
- 将来的なRedisクラスタリングの可能性を考慮したキー設計
- 適切なキー有効期限（TTL）の設定（必要に応じて）

### 永続化設定
- RDBスナップショットの頻度設定
- バックアップ戦略の検討

## 4. リスクと緩和策

### リスク1: データモデルの複雑さ
- **緩和策**: 段階的な実装と十分なテスト

### リスク2: パフォーマンスの問題
- **緩和策**: ベンチマークテストの実施と必要に応じた最適化

### リスク3: データ損失
- **緩和策**: 適切なバックアップ戦略の実装

### リスク4: 学習曲線
- **緩和策**: チームメンバーへのRedisトレーニングと詳細なドキュメント作成

## 5. タイムライン

1. **計画と設計**: 1週間
2. **フェーズ1-2（基本実装）**: 2週間
3. **フェーズ3（APIコントローラー実装）**: 1週間
4. **フェーズ4（テストと展開）**: 2週間

**合計**: 約6週間