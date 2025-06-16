# Dockerトラブルシューティング - 原因と修正方法

## 問題概要

devcontainer環境でDocker Composeを使用して各サービス（bot、backtest、web-ui）を起動した際に、以下のエラーが発生していた：

1. Docker権限エラー
2. コンテナ内でのモジュール不見つけエラー
3. ボリュームマウント競合エラー
4. 環境変数読み込み問題

## 根本原因の分析

### 1. Docker権限問題

**症状：**
```
permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock
```

**原因：**
- devcontainer内でDocker outside Dockerを使用する際、ホストのDockerデーモンにアクセスする権限がない
- ユーザーがdockerグループに属していない
- Docker socketの権限設定

**修正方法：**
```bash
# ユーザーをdockerグループに追加
sudo usermod -aG docker node

# Docker socketの権限を一時的に変更
sudo chmod 666 /var/run/docker.sock

# グループ設定を反映
newgrp docker
```

### 2. モジュールパス問題

**症状：**
```
Error: Cannot find module './src/bot'
```

**原因：**
- `bot.js`ファイル内で`require('./src/bot')`としていたが、実際のファイル名は`bot.js`
- Node.jsはファイル拡張子を省略した場合、複数の拡張子を試すが、ディレクトリ構造によっては正しく解決されない

**修正方法：**
```javascript
// 修正前
require('./src/bot');

// 修正後
require('./src/bot.js');
```

### 3. ボリュームマウント競合問題

**症状：**
```
not a directory: Are you trying to mount a directory onto a file (or vice-versa)?
```

**原因：**
- Docker Compose設定で個別ファイル（`.env`、`package.json`、`bot.js`）をボリュームマウントしていた
- devcontainer環境では、これらのファイルマウントが期待通りに動作せず、ディレクトリとして認識される問題
- ホスト側のファイルパスが正しく解決されない

**修正方法：**
```yaml
# 修正前 - 個別ファイルマウント
volumes:
  - ./src:/usr/src/app/src
  - ./package.json:/usr/src/app/package.json
  - .env:/usr/src/app/.env

# 修正後 - env_fileディレクティブ使用
env_file:
  - .env
volumes:
  - ./strategies:/usr/src/app/strategies
  - ./test:/usr/src/app/test
  - ./data:/usr/src/app/data
```

### 4. 環境変数読み込み問題

**症状：**
```
MongoDB接続エラー: Cannot read properties of undefined (reading 'startsWith')
```

**原因：**
- `.env`ファイルがボリュームマウントで正しく読み込まれていない
- `dotenv.config()`が空のファイルを読み込んでいる

**修正方法：**
- ボリュームマウントから`env_file`ディレクティブに変更
- Docker Composeが直接環境変数を注入するため、より確実

## ベストプラクティス

### 1. devcontainer環境でのDocker設定

```dockerfile
# .devcontainer/devcontainer.json
{
  "mounts": [
    "source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind"
  ],
  "runArgs": ["--privileged"]
}
```

### 2. Docker Compose設定パターン

```yaml
services:
  app:
    build: .
    env_file:
      - .env  # ファイルマウントではなくenv_fileを使用
    volumes:
      # ディレクトリマウントのみ
      - ./src:/app/src          # 開発時のホットリロード用
      - ./data:/app/data        # データ永続化用
      # 個別ファイルマウントは避ける
```

### 3. スクリプト実行時の注意点

```bash
# ホストから実行する場合（Redis/MongoDB接続エラーが発生する可能性）
node scripts/script.js

# 推奨：Docker内で実行
docker compose run --rm app node scripts/script.js

# または
docker compose exec app node scripts/script.js
```

### 4. 環境変数設定

```yaml
# Docker Compose内での環境変数優先順位
# 1. environment セクション（最高優先度）
# 2. env_file ディレクティブ
# 3. Dockerfileの ENV命令
# 4. docker run時の -e フラグ

services:
  app:
    env_file:
      - .env
    environment:
      - NODE_ENV=production  # .envの値をオーバーライド
```

## 予防策

### 1. 開発環境の統一化

- devcontainer設定の標準化
- Docker Compose設定のテンプレート化
- 環境変数管理の統一

### 2. エラーハンドリング

```javascript
// 環境変数の存在チェック
const mongoUrl = process.env.MONGO_URL;
if (!mongoUrl) {
  console.error('MONGO_URL環境変数が設定されていません');
  process.exit(1);
}
```

### 3. ドキュメント化

- 開発環境セットアップ手順の明文化
- トラブルシューティングガイドの整備
- FAQ形式でのよくある問題の記録

## 参考情報

- [Docker Compose環境変数リファレンス](https://docs.docker.com/compose/environment-variables/)
- [devcontainer Docker outside Docker](https://code.visualstudio.com/remote/advancedcontainers/use-docker-or-kubernetes)
- [Node.js モジュール解決アルゴリズム](https://nodejs.org/api/modules.html#modules_all_together)

---

**最終更新:** 2025-06-15  
**作成者:** Claude Code Assistant