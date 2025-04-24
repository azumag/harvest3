# Redisデータベース設計書

## 概要

このドキュメントでは、SQLiteからRedisへの移行の一環として実装されたRedisデータベースの構造を詳細に説明します。

## データモデル

Redisはキーバリューストアですが、本システムでは複雑なデータ構造を実現するために、キー命名規則とインデックスを駆使した設計となっています。

## 基本構造

### 階層インデックス

システムは以下の階層でデータを整理しています：

1. 取引所 (Exchange)
2. 通貨ペア (Symbol)
3. 戦略 (Strategy)

これらの関係は以下のRedisセットで管理されています：

- `exchanges` - 全取引所のIDセット
- `symbols:{exchangeId}` - 特定取引所の全通貨ペアセット
- `strategies:{exchangeId}:{symbol}` - 特定取引所と通貨ペアの全戦略セット

## 主要データ構造

### 1. 注文ペア (Order Pairs)

現在の注文ペアを管理するためのデータ構造です。

**キー形式**: `currentOrderPair:{exchangeId}:{symbol}:{strategyKey}`

**データ形式**: JSONオブジェクト

```json
{
  "pair": {
    // ペアデータ
  }
}
```

**関連関数**:
- `setCurrentOrderPair()` - 注文ペアを設定
- `getCurrentOrderPair()` - 注文ペアを取得

### 2. 取引記録 (Order Records)

注文の記録を管理するためのデータ構造です。

#### 注文サマリー

**キー形式**: `trade:orderSummary:{exchangeId}:{symbol}:{strategyKey}`


**データ形式**: Redisハッシュ

```
{
  "buyAmount": float,       // 買い注文の総量
  "sellAmount": float,      // 売り注文の総量
  "totalBuyCost": float,    // 買い注文の総価格
  "totalSellValue": float,  // 売り注文の総価格
  "netPosition": float,     // ポジション
  "createdAt": timestamp,   // 作成日時
  "updatedAt": timestamp    // 更新日時
}
```

#### 注文履歴

**キー形式**: `trade:orderHistory:{exchangeId}:{symbol}:{strategyKey}`

**データ形式**: Redisリスト（JSON文字列）

```json
{
  "orderId": string,       // 注文ID
  "amount": float,         // 数量
  "side": string,          // 取引方向（buy/sell）
  "price": float,          // 価格
  "orderType": string,     // 注文タイプ
  "orderedAt": timestamp   // 注文日時
}
```

#### 注文インデックス

- `order:index:{orderId}` - 注文IDから取引所:通貨ペア:戦略キーへのマッピング
- `order:details:{orderId}` - 注文IDから注文詳細へのマッピング

#### 時系列インデックス

- `trade:orderSummary:time` - 注文サマリーの時系列インデックス（Zset）
- `trade:orderHistory:time` - 注文履歴の時系列インデックス（Zset）

**関連関数**:
- `addTrade()` - 注文記録を追加
- `getOrderHistory()` - 注文履歴を取得

### 3. 約定記録 (Filled Trade Records)

実際に約定した取引の記録を管理するためのデータ構造です。

#### 約定サマリー

**キー形式**: `trade:filledSummary:{exchangeId}:{symbol}:{strategyKey}`

**データ形式**: Redisハッシュ

```
{
  "buyAmount": float,       // 買い約定の総量
  "sellAmount": float,      // 売り約定の総量
  "totalBuyCost": float,    // 買い約定の総コスト
  "totalSellValue": float,  // 売り約定の総価値
  "netPosition": float,     // ポジション
  "totalFee": float,        // 総手数料
  "realizedPnL": float,     // 実現損益
  "createdAt": timestamp,   // 作成日時
  "updatedAt": timestamp    // 更新日時
}
```

#### 約定履歴

**キー形式**: `trade:filledHistory:{exchangeId}:{symbol}:{strategyKey}`
**データ形式**: Redisリスト（JSON文字列）

```json
{
  "orderId": string,       // 注文ID
  "amount": float,         // 数量
  "side": string,          // 取引方向（buy/sell）
  "price": float,          // 価格
  "orderType": string,     // 注文タイプ
  "fee": float,            // 手数料
  "filledAt": timestamp    // 約定日時
}
```

#### 約定インデックス

- `filledOrder:details:{orderId}` - 注文IDから約定詳細へのマッピング

#### 重複防止インデックス

- `trade:uniqueTradeFullHashes:{exchangeId}:{symbol}:{strategyKey}` - 完全なトレードハッシュのセット
- `trade:uniqueTradeContentHashes:{exchangeId}:{symbol}:{strategyKey}` - トレード内容ハッシュのセット

#### 時系列インデックス

- `trade:filledSummary:time` - 約定サマリーの時系列インデックス（Zset）
- `trade:filledHistory:time` - 約定履歴の時系列インデックス（Zset）

**関連関数**:
- `addFilledTrade()` - 約定記録を追加
- `getFilledHistory()` - 約定履歴を取得
- `getFilledSummary()` - 約定サマリーを取得
- `getTradeSummary()` - 期間別取引サマリーを取得

### 4. 戦略シグナル (Strategy Signals)

戦略が生成するシグナルを管理するためのデータ構造です。

#### シグナル履歴

**キー形式**: `strategy:signalHistory:{exchangeId}:{symbol}:{strategyKey}`

**データ形式**: Redisリスト（JSON文字列）

```json
{
  "timestamp": timestamp,   // シグナル生成日時
  "signalType": string,     // シグナル種別（buy/sell/none）
  "price": float,           // 現在価格
  "strategyResults": object // 戦略固有の計算結果
}
```

#### 時系列インデックス

- `strategy:signalHistory:time` - シグナル履歴の時系列インデックス（Zset）

**関連関数**:
- `addStrategySignal()` - 戦略シグナルを追加
- `getStrategySignalHistory()` - 戦略シグナル履歴を取得

### 5. 戦略パラメータ (Strategy Parameters)

戦略のパラメータを管理するためのデータ構造です。

**キー形式**: `strategyParams:{exchangeId}:{symbol}:{strategyKey}`

**データ形式**: Redisハッシュ（キーと値のペア）

**関連関数**:
- `saveStrategyParameters()` - 戦略パラメータを保存
- `getStrategyParameters()` - 戦略パラメータを取得

## 時系列管理

時系列データの効率的な管理のために、以下のZsetが使用されています：

- `trade:orderSummary:time` - 取引サマリーの時系列インデックス
- `trade:orderHistory:time` - 取引履歴の時系列インデックス
- `trade:filledSummary:time` - 約定サマリーの時系列インデックス
- `trade:filledHistory:time` - 約定履歴の時系列インデックス
- `strategy:signalHistory:time` - 戦略シグナル履歴の時系列インデックス

これらのZsetでは、スコアにタイムスタンプ、値にデータの識別子を使用しています。

## 重複防止メカニズム

約定記録の重複を防ぐために、以下の2つのセットが使用されています：

- `trade:uniqueTradeFullHashes:{exchangeId}:{symbol}:{strategyKey}` - トレードIDを含む完全なハッシュ
- `trade:uniqueTradeContentHashes:{exchangeId}:{symbol}:{strategyKey}` - トレードIDを除くコンテンツハッシュ

これにより、同一トレードの完全な重複と部分約定による内容の重複を効率的に検出できます。

## パフォーマンス最適化

### キャッシュ

頻繁にアクセスされるデータのために、メモリ内キャッシュが実装されています：
- `orderStrategyKeyCache` - 注文IDから戦略キーへのマッピングキャッシュ

### インデックス

クエリの高速化のために、以下のインデックスが実装されています：
- 注文IDインデックス (`order:index:{orderId}`)
- 注文詳細インデックス (`order:details:{orderId}`)
- 約定詳細インデックス (`filledOrder:details:{orderId}`)

### データ構造の選択

- 単一値データには文字列（SET）
- 関連データのグループにはハッシュ（HSET）
- 時系列データにはリスト（RPUSH）とソート済みセット（ZADD）
- セットベースの検索にはセット操作（SADD, SMEMBERS）
- 高速存在チェックにはセットメンバーシップ（SISMEMBER）

## データフロー

1. 取引所、通貨ペア、戦略が階層的にインデックス化される
2. 注文が作成されると取引記録（orderSummary, orderHistory）に追加される
3. 注文が約定すると約定記録（filledSummary, filledHistory）に追加される
4. 戦略がシグナルを生成するとシグナル履歴に追加される
5. 各種サマリーは取引/約定が追加されるたびに更新される

## データ整合性

- 重複防止: ハッシュベースの重複検出
- 原子性: Redis操作の単一性を活用
- 一貫性: サマリーと履歴の同期更新

## データアクセスパターン

### 一般的なクエリパターン

1. 特定戦略の現在のポジション照会
   - `trade:filledSummary:{exchangeId}:{symbol}:{strategyKey}` を HGETALL

2. 取引履歴の時系列検索
   - `trade:filledHistory:time` を ZRANGEBYSCORE で時間範囲指定
   - 結果の各エントリから対応する履歴データをLRANGE

3. 戦略のパフォーマンス分析
   - `trade:filledSummary:{exchangeId}:{symbol}:{strategyKey}` から損益情報取得

4. 注文IDから関連情報の逆引き
   - `order:index:{orderId}` から戦略情報を取得
   - `order:details:{orderId}` から注文詳細を取得

## 将来の拡張性

- スケーラビリティ: キー設計によりシャーディングが可能
- データエクスピレーション: TTLの導入による古いデータの自動削除
- バックアップ: RDBとAOF両方によるデータ永続化

## 結論

このRedisデータベース設計は、取引システムの高パフォーマンスな要件に対応するために最適化されています。キー・バリューストアの特性を活かしつつ、複雑なデータ関係と効率的なクエリパターンを実現しています。


