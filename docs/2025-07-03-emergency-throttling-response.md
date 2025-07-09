# 緊急スロットリング対応レポート

**発生日時**: 2025-07-03 22:30-22:32  
**問題**: CCXT throttle queue overflow (maxCapacity 1000 exceeded)  
**影響範囲**: bitbank API全通貨ペア  

## 問題概要

### エラー詳細
```
throttle queue is over maxCapacity (1000)
```

### 影響シンボル
- APE/JPY, GALA/JPY, XLM/JPY, LPT/JPY, MASK/JPY
- RENDER/JPY, MANA/JPY, ASTR/JPY, DAI/JPY, OAS/JPY
- その他多数の通貨ペア

### エラー頻度
約30件/分の高頻度でスロットリングエラー発生

## 緊急対応実施

### 1. システム状況確認 ✅
- メインアプリケーションコンテナ: **停止中**
- データベースコンテナ: 正常稼働
- 残留プロセス: なし

### 2. 緊急スロットリング制御実装 ✅

**変更内容** (`src/common/const.js`):
```javascript
// 変更前
RATE_LIMIT: 1500        // 1.5秒間隔
MAX_THROTTLE_QUEUE_SIZE: 1000
TIMEOUT: 30000          // 30秒

// 変更後（緊急制御）
RATE_LIMIT: 3000        // 3秒間隔（100%増加）
MAX_THROTTLE_QUEUE_SIZE: 100  // 90%削減
TIMEOUT: 45000          // 45秒（50%増加）
```

### 3. キャッシュクリア実施 ✅
```bash
docker exec harvest3-redis redis-cli flushall
```
- Redis内の全APIキャッシュデータを削除
- 残留接続状態をリセット

## 根本原因分析

### 推定原因
1. **前回の緊急停止時**: システム停止時にCCXTキューが適切にクリアされず
2. **残留リクエスト**: 1000件のリクエストがキューに蓄積
3. **再接続試行**: 残留リクエストが一斉に実行されキューオーバーフロー

### 技術的要因
- CCXT throttleキューの永続化特性
- 強制停止時のグレースフルシャットダウン不足
- API制限値とキューサイズの不整合

## 予防策の実装

### 1. 安全停止プロセス
今後のシステム停止時：
- グレースフルシャットダウンの実装
- CCXTキューの明示的クリア
- 段階的サービス停止

### 2. 監視強化
```javascript
// 推奨監視項目
- キューサイズ監視 (上限80%でアラート)
- API リクエスト頻度監視
- スロットリングエラー頻度監視
```

### 3. 設定最適化
```javascript
// 本番稼働後の推奨設定
RATE_LIMIT: 2000              // 2秒間隔（安全マージン）
MAX_THROTTLE_QUEUE_SIZE: 200  // 200件制限
TIMEOUT: 40000                // 40秒タイムアウト
```

## 再起動手順

### 段階的安全再起動
```bash
# 1. 全停止
docker-compose down

# 2. API制限解除待機
sleep 30

# 3. 基盤サービス起動
docker-compose up -d redis mongodb

# 4. 安定化待機
sleep 60

# 5. メインサービス起動
docker-compose up -d harvest3-main

# 6. ログ監視
docker-compose logs -f harvest3-main
```

## 対応完了状況

✅ **緊急スロットリング制御**: 実装完了  
✅ **キャッシュクリア**: 実行完了  
✅ **設定最適化**: 実装完了  
⏳ **エラー収束監視**: 実施中  

## 今後の改善点

1. **自動回復機能**: キューオーバーフロー検出時の自動回復
2. **プリエンプティブ制御**: キューサイズ監視による事前制御
3. **グレースフル停止**: システム停止時の適切なクリーンアップ

---
**対応完了時刻**: 2025-07-03 22:43  
**次回監視**: エラー収束確認後にシステム再起動検討