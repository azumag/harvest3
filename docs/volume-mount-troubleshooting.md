# Dockerボリュームマウント問題の解決ガイド

## 問題の概要

Docker環境において、ホストとコンテナ間でファイル変更が正常に反映されない問題が発生する場合があります。特に開発環境では、ソースコードの変更がコンテナ内で即座に反映されない現象が起きることがあります。

## 主な原因

### 1. ボリュームマウントの同期遅延
- OSのファイルシステムキャッシュによる遅延
- Dockerデーモンの内部的な同期処理の遅れ
- ファイルの更新タイムスタンプの不整合

### 2. コンテナ内プロセスのキャッシュ
- Node.jsの`require()`キャッシュ
- アプリケーションレベルでのファイルキャッシュ
- プロセスが古いファイル内容を保持

### 3. Docker設定の問題
- ボリュームマウントの設定ミス
- 権限の不整合
- パフォーマンス最適化による副作用

## 解決方法

### 1. コンテナ再起動による確実な反映

#### 推奨コマンド（Makefile使用）
```bash
# バックテスト関連の変更時
make quick-restart-backtest

# 戦略実行関連の変更時  
make quick-restart-bot

# 全体を確実に反映したい場合
make restart-all
```

#### 手動でのコンテナ再起動
```bash
# 特定のサービスの再起動
docker compose restart [service-name]

# 完全な停止・再起動（確実だが時間がかかる）
docker compose down [service-name]
docker compose up -d [service-name]
```

### 2. ファイル同期状況の確認方法

#### タイムスタンプ比較
```bash
# ホストとコンテナのファイルタイムスタンプを比較
diff <(docker exec [container-name] stat -c "%Y %n" /path/to/file) \
     <(stat -c "%Y %n" /host/path/to/file)
```

#### ファイル内容の比較
```bash
# ファイル内容が同期されているかチェック
docker exec [container-name] cat /path/to/file | diff - /host/path/to/file
```

### 3. 開発フローの改善

#### ファイル変更後の手順
1. **ファイル保存後、必ずコンテナ再起動**
2. **ログで動作確認**
3. **期待する変更が反映されていることを確認**

```bash
# 変更後の確認フロー例
# 1. ファイル変更
echo "console.log('test');" >> src/bot.js

# 2. コンテナ再起動
make quick-restart-bot

# 3. ログ確認
docker compose logs -f bot

# 4. 必要に応じて動作テスト
```

### 4. WebUI関連の特別な対応

WebUIの変更時は、必ず以下の手順を実行：

```bash
# WebUIサービスの再起動（毎回必須）
docker compose restart web-ui

# ブラウザでの動作確認
# - コンソールエラーがないことを確認
# - 期待される動作が行われることを確認
# - キャッシュクリアも実行
```

## 予防策

### 1. 開発環境の設定最適化

#### docker-compose.ymlの設定確認
```yaml
services:
  bot:
    volumes:
      # 相対パスでのマウント（推奨）
      - ./src:/usr/src/app/src
      # 絶対パスは避ける
```

### 2. ホットリロード機能の活用

#### nodemonの使用
```dockerfile
# Dockerfile内でnodemonをインストール
RUN npm install -g nodemon

# 開発用コマンドでnodemonを使用
CMD ["nodemon", "src/bot.js"]
```

### 3. ファイル監視の設定

#### 開発環境でのファイル監視
```bash
# ファイル変更を監視して自動再起動
watch -n 1 'make quick-restart-bot'
```

## トラブルシューティング

### よくある問題と対処法

#### 1. 変更が反映されない
```bash
# 解決策：強制的にコンテナを再作成
docker compose down [service-name]
docker compose up -d [service-name]
```

#### 2. 権限エラー
```bash
# 解決策：権限の確認と修正
ls -la /workspace/src/
docker exec [container-name] ls -la /usr/src/app/src/
```

#### 3. キャッシュ問題
```bash
# 解決策：Dockerキャッシュのクリア
docker system prune -f
docker compose build --no-cache
```

### 診断コマンド

#### マウント状況の確認
```bash
# コンテナのマウント情報を確認
docker inspect [container-name] | grep -A 10 "Mounts"

# ボリューム一覧
docker volume ls

# コンテナ内のファイル確認
docker exec [container-name] ls -la /usr/src/app/src/
```

## 重要な注意事項

### 禁止事項
- **絶対パスの使用禁止**: docker関連に絶対パスを使用しない
- **docker cp禁止**: `docker cp`コマンドは使用しない
- **データ直接操作禁止**: コンテナを停止せずにファイルを直接操作しない

### 推奨事項
- **変更後は必ず再起動**: ファイル変更後は確実にコンテナを再起動
- **ログの確認**: 再起動後は必ずログで動作確認
- **段階的な確認**: 小さな変更でも動作確認を行う

## まとめ

ボリュームマウントの問題は、主にファイル同期の遅延とキャッシュが原因です。確実な解決策は**コンテナの再起動**です。開発効率を上げるために、変更後の再起動を習慣化し、適切な診断コマンドで状況を把握することが重要です。