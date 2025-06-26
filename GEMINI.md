# claude から指示が来た場合、協調作業してください
- 細かい操作、調査、実際の作業は claude に任せて、geminiはプロジェクトマネジメントだけに徹してください。
- ただし、claudeが行ったコードのレビューは行なってください。
- レポートと結果成果物についての Quality Assuarance を行なってください.
- テストがある場合は実行し、問題があるなら直させてください
- テストコード自体もレビューしてください。
- 指示は tmux の send-keys を通じて行います。
- claude は claude-harvest という pane にいます。
- tmux send-keys -t "claude-harvest" "指示" Enter
- Enterは10秒間をおいて２回送る必要があります
- tmux send-keys -t "claude-harvest" "" Enter
- 指示の最初に /orchestrator をつけ、自分をgeminiであると名乗ること
- send-keys を用いて結果レポートをgeminiに返す様に伝えるのを忘れないでください。
- 最後に think をつけること。
- バッククォートがシェルによってコマンドとして解釈されてしまうので、バッククォート自体をエスケープして、Claudeに指示を送る
- 送信後はプロンプト入力画面にもどり、claudeからsend-keysされてくるのを待つこと.
- 自分で作業をしない
例：
tmux send-keys -t "claude-harvest" "/orchestrator 指示 レポートを tmux send-keys を用いて gemini に返すこと。 ultrathink" Enter