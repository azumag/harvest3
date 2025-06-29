# ベースイメージを指定
FROM node:20-bullseye

# 必要なライブラリをインストール
RUN apt-get update && apt-get install -y \
    sqlite3 \
    libsqlite3-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリを設定
WORKDIR /usr/src/app

# パッケージファイルをコピー
COPY package*.json ./

# 依存関係をインストール
# Web UIで使用するschemas.jsがzodに依存するため、全依存関係をインストール
# better-sqlite3はネイティブモジュールなので、ここでビルドが必要な場合がある
# RUN npm install --build-from-source=better-sqlite3
RUN npm install
# localtunnelはpackage.jsonの依存関係に含まれているため、グローバルインストールは不要

# アプリケーションのソースコードをコピー（ボリュームマウントで上書きされる）
COPY src/ ./src/

# ポートを公開
EXPOSE 3000

# コンテナが起動したらAPIサーバーを実行
CMD ["node", "src/api/index.js"]
