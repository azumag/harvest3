# devcontainer + Docker Outside Docker環境でのボリュームマウント問題調査報告書

## 📋 調査概要

**環境**: devcontainer + docker outside docker (macOS)  
**問題**: 新規作成ファイルがDockerコンテナ内に反映されない  
**調査日時**: 2025-06-18  

## 🔍 環境詳細

### devcontainer設定
```json
{
  "features": {
    "ghcr.io/devcontainers/features/docker-outside-of-docker:1": {}
  },
  "mounts": [
    "source=/var/run/docker.sock,target=/var/run/docker.sock,type=bind"
  ],
  "workspaceMount": "source=${localWorkspaceFolder},target=/workspace,type=bind",
  "workspaceFolder": "/workspace"
}
```

### Docker環境
- **Docker Version**: 28.2.2
- **Docker Compose Version**: 2.37.0
- **ファイルシステム**: virtiofs (macOS)
- **マウント情報**: `mac on /workspace type virtiofs (rw,relatime)`

## 🚨 問題の詳細

### 症状
1. **ホスト側**: `/workspace/src/common/balanceChecker.js` が存在
2. **コンテナ側**: `/usr/src/app/src/common/balanceChecker.js` が存在しない
3. **マウント設定**: 正常 (`/workspace/src` → `/usr/src/app/src`)
4. **リアルタイム同期**: 新規ファイル作成後もコンテナに反映されない

### タイムライン分析
```
23:56:17 - balanceChecker.js ファイル作成
23:59:11 - strategy-runnerコンテナ作成
00:00:00 - strategy-runnerコンテナ開始
```

**結論**: ファイルはコンテナ作成の3分前に存在したが、コンテナには反映されていない

## 🔧 根本原因の特定

### 1. Docker Outside Docker の制約
- devcontainer内の `/workspace` パス
- Docker Composeは同じ `/workspace` から実行
- しかし、bindマウントの実際の解決でパス競合が発生

### 2. virtiofs同期問題 (macOS固有)
- macOSのDocker Desktopのファイル共有機構
- devcontainerとホストDockerプロセス間での同期遅延
- ファイルシステム監視の競合

### 3. コンテナ作成時のスナップショット効果
- コンテナ作成時点でのファイルシステム状態を「固定化」
- 後からファイルが追加されても認識されない現象
- bindマウントの初期化タイミング問題

### 4. Docker Daemon のファイル監視制限
- devcontainer → Docker daemon → container の経路で監視が途切れる
- inotify/fseventsイベントの伝播問題

## 📊 検証結果

### ボリュームマウント設定確認
```bash
# 正常にマウント設定されている
"Source": "/workspace/src",
"Destination": "/usr/src/app/src",
"Mode": "rw",
"RW": true,
"Propagation": "rprivate"
```

### 同期テスト結果
```bash
# ホスト側ファイル存在確認
$ ls -la /workspace/src/common/balanceChecker.js
-rw-r--r-- 1 node node 6664 Jun 17 23:56 balanceChecker.js

# コンテナ側ファイル確認
$ docker exec strategy-runner ls -la /usr/src/app/src/common/balanceChecker.js
ls: cannot access '/usr/src/app/src/common/balanceChecker.js': No such file or directory

# リアルタイム同期テスト
$ echo "test" > /workspace/src/common/test-sync.txt
$ docker exec strategy-runner cat /usr/src/app/src/common/test-sync.txt
cat: can't open '/usr/src/app/src/common/test-sync.txt': No such file or directory
```

## 💡 解決策

### 🎯 推奨解決策: 完全再構築
1. **コンテナ完全停止・削除**
   ```bash
   docker compose down
   docker system prune -f
   ```

2. **イメージ再構築**
   ```bash
   docker compose build --no-cache
   ```

3. **コンテナ再作成・起動**
   ```bash
   docker compose up -d
   ```

### 🔄 代替解決策: 強制同期
1. **ファイルをコンテナ内でも作成**
   ```bash
   docker exec strategy-runner mkdir -p /usr/src/app/src/common
   docker cp /workspace/src/common/balanceChecker.js strategy-runner:/usr/src/app/src/common/
   ```

2. **コンテナ再起動**
   ```bash
   docker compose restart bot
   ```

### ⚠️ 一時的回避策: ファイル配置変更
既存ディレクトリに機能を統合（`src/common/notifications.js` に追加など）

## 🚀 予防策

### 1. 開発フロー改善
- **新規ファイル作成時は必ずコンテナ再構築**
- **ファイル変更は既存ファイルの編集を優先**

### 2. 監視体制強化
- **定期的なファイル同期チェック**
  ```bash
  # 毎回の開発開始時にチェック
  make verify-mount-sync
  ```

### 3. Docker設定最適化
- **compose.ymlでのvolume設定見直し**
- **必要に応じてnamed volumeの活用**

## 📝 まとめ

**devcontainer + docker outside docker環境では、新規ファイル作成時のボリュームマウント同期に固有の問題が存在する。根本原因はmacOSのvirtiofs、Docker daemon、devcontainerの三層構造での同期遅延・競合である。**

**解決には完全なコンテナ再構築が最も確実で、今後は新規ファイル作成時の運用フロー見直しが必要。**