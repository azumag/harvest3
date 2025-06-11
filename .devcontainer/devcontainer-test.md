# Dev Container 動作確認手順

## 1. VS Codeでの開き方

1. VS Codeで当プロジェクトを開く
2. コマンドパレット（Cmd+Shift+P または Ctrl+Shift+P）を開く
3. "Dev Containers: Reopen in Container" を選択
4. 初回はDockerイメージのビルドが行われるので待つ

## 2. Docker動作確認

Dev Container内のターミナルで以下のコマンドを実行：

```bash
# Dockerバージョン確認（ホスト側のDockerが表示される）
docker --version

# 実行中のコンテナ一覧（ホスト側のコンテナが表示される）
docker ps

# docker-composeの動作確認
cd /workspace
docker-compose ps
```

## 3. 設定内容

- **Docker Outside of Docker**: ホスト側のDockerソケット（/var/run/docker.sock）をマウント
- **ユーザー**: nodeユーザー（UID: 1000）で実行
- **作業ディレクトリ**: /workspace
- **ポートフォワード**: 3000, 8080
- **拡張機能**: ESLint, Prettier, Docker拡張機能が自動インストール

## 4. トラブルシューティング

### Dockerコマンドが実行できない場合

```bash
# dockerグループの確認
groups

# ソケットの権限確認
ls -la /var/run/docker.sock

# 権限エラーの場合（一時的な対処）
sudo chmod 666 /var/run/docker.sock
```