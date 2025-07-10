#!/bin/bash

docker compose down
docker compose up bot backtest -d
exit 0