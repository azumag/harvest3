# ベースイメージを指定
FROM node:16

# 作業ディレクトリを設定
WORKDIR /usr/src/app

# パッケージファイルをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install

# アプリケーションのソースコードをコピー
COPY . .

# コンテナが起動したらこのコマンドを実行
CMD [ "npm", "start" ]
