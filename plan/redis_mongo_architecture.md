# Redis × MongoDB 履歴データアーキテクチャ設計書

## 概要

本システムでは、頻繁に更新される履歴データを高速に扱うために Redis を使用しつつ、過去データを永続保存・分析可能にするため MongoDB に退避するハイブリッド構成を採用する。

- 直近データの高速アクセス：Redis（インメモリ）
- 過去データの長期保管・分析：MongoDB（ディスク）

---

## システム構成

```
[クライアントUI]
       ↓
    [アプリ層]
       ↓
 ┌──────────────┐
 │ Redis（直近） │ ← 頻繁な書き込み・読み取り
 └──────────────┘
       ↓ 日次バッチ移行
 ┌──────────────┐
 │ MongoDB（過去）│ ← 長期保存・分析用
 └──────────────┘
```

---

## データのライフサイクル

| フェーズ       | 処理内容 |
|----------------|-----------|
| リアルタイム更新 | Redis に書き込み |
| UIアクセス       | 直近は Redis から取得、過去は MongoDB から取得 |
| 日次移行         | 前日分の履歴を Redis → MongoDB に退避、Redis からは削除 |
| 分析             | MongoDB 上で集計・検索・統計処理を実施 |

---

## Redis 設計

- キー構造例：`history:<user_id>:<timestamp>`
- 値の構造：`HSET` によるハッシュ型（履歴内容）

### Redis に保持する期間
- 24時間以内の履歴データのみ保持
- それ以前は MongoDB に移行＆削除

---

## MongoDB 設計

- コレクション名：`histories`
- ドキュメント例：

```json
{
  "user_id": "abc123",
  "action": "login",
  "timestamp": 1713789600,
  "meta": {...},
  "redis_key": "history:abc123:1713789600"
}
```

- インデックス推奨：`user_id`, `timestamp`, `action`

---

## バッチ処理設計（Redis → Mongo）

### 実行タイミング
- 1日1回（cron / Sidekiq / Heroku Schedulerなど）

### 処理概要（擬似コード）

```ruby
redis.keys("history:*").each do |key|
  data = redis.hgetall(key)
  next if data["timestamp"].to_i > 1.day.ago.to_i

  mongo[:histories].insert_one(data.merge(redis_key: key))
  redis.del(key)
end
```

---

## UI における切り替え処理

```ruby
def get_history(user_id:, from:, to:)
  if from > 1.day.ago
    fetch_from_redis(user_id, from, to)
  else
    fetch_from_mongo(user_id, from, to)
  end
end
```

---

## 想定される利点

- 高速アクセスと長期保存の両立
- メモリ使用量の抑制（Redis限定）
- 分析用途では MongoDB の集計機能をフル活用可能
- シンプルな一方向アーキテクチャで運用も安全

---

## 今後の拡張候補

- Mongo に保存した履歴を定期的に圧縮・ローテーション
- Mongo 上に集計サマリーを別途保存（ダッシュボード高速化）
- Redis の Pub/Sub を使ったリアルタイム通知連携
- 分析に特化した別サーバで Mongo クエリ実行
