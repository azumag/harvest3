バックテスト用の戦略起動スクリプト backtest.js を作る

docker compose で backtest コンテナを起動

src/backtest.js で bot.js 相当の起動を行う
- marketParameter, symbolByExchange などはダミー値でいい
- options:backtestを渡す
- optionsの中身を見て結果を保存、レポートを確認（discordでいいかも）

共通化できるところはする

ループは各戦略・通貨ごとに OHLCTimeframe ごとにやる
1年前から4/29までの時刻をtimeframe刻みの時間を生成してループする
生成した時間 timestamp を options.backtest.timestamp に入れる

シグナルや注文のDiscord通知はオフ