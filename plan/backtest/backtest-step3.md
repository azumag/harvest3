バックテスト用の戦略起動スクリプト backtestRunner.js を作る

src/backtest.js で bot.js 相当の起動を行う
- marketParameter, symbolByExchange は最初に一回だけ取得する

- options:backtest を作って渡す
- optionsの中身を見て結果を保存、レポートをdiscordで投稿

ループは各戦略・通貨ごとに OHLCTimeframe ごとにやる
1年前から4/29までの時刻をtimeframe刻みの時間を生成してループする
生成した時間 timestamp を options.backtest.timestamp に入れる
シグナルや注文のDiscord通知はオフにしたい