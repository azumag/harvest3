# ベースイメージを指定
FROM node:16-bullseye

# 必要なライブラリをインストール
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    g++ \
    make \
    gcc \
    sqlite3 \
    libsqlite3-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# GCCの新しいバージョンをインストール（C++20サポート用）
RUN apt-get update && apt-get install -y gcc-10 g++-10 \
    && update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-10 100 \
    && update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-10 100 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリを設定
WORKDIR /usr/src/app

# パッケージファイルをコピー
COPY package*.json ./

# better-sqlite3を正しいアーキテクチャ向けにビルド
RUN npm install --build-from-source=better-sqlite3

# アプリケーションのソースコードをコピー（node_modulesを除外）
COPY src/ ./src/
COPY strategies/ ./strategies/
COPY scripts/ ./scripts/
COPY test/ ./test/
COPY bot.js .
COPY *.json ./

# コンテナが起動したらこのコマンドを実行
CMD [ "npm", "start" ]
