バックテスト用の戦略起動スクリプト backtest.js を作る

docker compose で backtest コンテナを起動

src/backtest.js で bot.js 相当の起動を行う
- marketParameter, symbolByExchange などはダミー値でいい
- 

共通化できるところはする

呼び出し側戦略は、backtest: true
ループは各戦略・通貨ごとに OHLCTimeframe ごとにやる
1年前から4/29までの時刻をtimeframe刻みの時間を生成してループする

Discord通知はオフ