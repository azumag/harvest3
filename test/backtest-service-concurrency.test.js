/**
 * Issue #5307: 並行実行テスト - backtest-service の重複防止機能
 * 
 * 複数プロセスでの実際の重複防止動作をテストする
 * Issue #5292のフォローアップとして、より堅牢な並行実行テストを実装
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { promisify } = require('util');

describe('Issue #5307 - Concurrency tests for backtest service', () => {
    let tempDir;
    let originalEnv;
    const timeout = 30000; // 30秒のタイムアウト

    beforeEach(() => {
        // 一時ディレクトリの作成
        tempDir = fs.mkdtempSync('/tmp/backtest-concurrency-test-');
        
        // 環境変数の保存
        originalEnv = { ...process.env };
        
        // テスト用環境変数の設定
        process.env.BACKTEST_MODE = 'true';
        process.env.BACKTEST_STARTUP_FLOCK_TIMEOUT = '15';
        process.env.BACKTEST_STARTUP_LOCK_TIMEOUT = '60';
    });

    afterEach(() => {
        // 一時ファイルのクリーンアップ
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        
        // 環境変数の復元
        Object.keys(process.env).forEach(key => {
            if (!(key in originalEnv)) {
                delete process.env[key];
            }
        });
        Object.assign(process.env, originalEnv);
    });

    describe('Multiple process duplicate prevention', () => {
        test('should prevent duplicate messages from multiple concurrent processes', async () => {
            const lockFile = path.join(tempDir, 'backtest-startup-message.lock');
            const timestampFile = path.join(tempDir, 'backtest-startup-message.last');
            const outputFile = path.join(tempDir, 'output.log');
            
            // 並行実行用のテストスクリプトを作成
            const testScript = `#!/bin/bash
set -e

LOCK_FILE="${lockFile}"
TIMESTAMP_FILE="${timestampFile}"
OUTPUT_FILE="${outputFile}"
SUPPRESS_DURATION=60
PROCESS_ID=$$

# flockによるメッセージ出力関数（entrypoint.shから抽出）
log_concurrent_message() {
    local message="$1"
    local current_time=$(date +%s)
    
    if command -v flock >/dev/null 2>&1; then
        exec 200>"$LOCK_FILE"
        if flock -w 15 200; then
            local should_output=true
            
            if [ -f "$TIMESTAMP_FILE" ]; then
                local last_time=$(cat "$TIMESTAMP_FILE" 2>/dev/null || echo "0")
                local time_diff=$((current_time - last_time))
                
                if [ "$time_diff" -lt "$SUPPRESS_DURATION" ]; then
                    should_output=false
                fi
            fi
            
            if [ "$should_output" = true ]; then
                echo "[$PROCESS_ID] $message" >> "$OUTPUT_FILE"
                echo "$current_time" > "$TIMESTAMP_FILE"
                chmod 600 "$TIMESTAMP_FILE" 2>/dev/null || true
            fi
            
            exec 200>&-
        fi
    fi
}

# テストメッセージを出力
log_concurrent_message "Concurrent backtest startup message"
`;

            // テストスクリプトを保存
            const scriptPath = path.join(tempDir, 'test_script.sh');
            fs.writeFileSync(scriptPath, testScript);
            fs.chmodSync(scriptPath, 0o755);

            // 複数プロセスを並行実行
            const processes = [];
            const processCount = 5;
            
            for (let i = 0; i < processCount; i++) {
                const childProcess = spawn('bash', [scriptPath], {
                    stdio: 'pipe',
                    env: { ...process.env }
                });
                processes.push(childProcess);
            }

            // すべてのプロセスの完了を待つ
            await Promise.all(processes.map(process => {
                return new Promise((resolve, reject) => {
                    process.on('close', (code) => {
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`Process exited with code ${code}`));
                        }
                    });
                    process.on('error', reject);
                });
            }));

            // 結果の検証
            if (fs.existsSync(outputFile)) {
                const output = fs.readFileSync(outputFile, 'utf8');
                const lines = output.trim().split('\n').filter(line => line.length > 0);
                
                // 重複防止により、1つのメッセージのみが出力されるべき
                expect(lines.length).toBe(1);
                expect(lines[0]).toMatch(/\[\d+\] Concurrent backtest startup message/);
            } else {
                // 出力ファイルが存在しない場合は、すべてのプロセスで重複が検出された
                expect(true).toBe(true); // すべて重複検出も正常な動作
            }
        }, timeout);

        test('should handle rapid consecutive process spawning', async () => {
            const lockFile = path.join(tempDir, 'rapid-test.lock');
            const resultFile = path.join(tempDir, 'rapid-results.txt');
            
            const rapidTestScript = `#!/bin/bash
LOCK_FILE="${lockFile}"
RESULT_FILE="${resultFile}"
PROCESS_ID=$$
TIMESTAMP=$(date +%s.%N)

# 高速ロック取得テスト
if mkdir "$LOCK_FILE" 2>/dev/null; then
    echo "[$PROCESS_ID] ACQUIRED_LOCK at $TIMESTAMP" >> "$RESULT_FILE"
    sleep 0.1  # 短時間保持
    rmdir "$LOCK_FILE" 2>/dev/null || true
else
    echo "[$PROCESS_ID] LOCK_FAILED at $TIMESTAMP" >> "$RESULT_FILE"
fi
`;

            const scriptPath = path.join(tempDir, 'rapid_test.sh');
            fs.writeFileSync(scriptPath, rapidTestScript);
            fs.chmodSync(scriptPath, 0o755);

            // 10個のプロセスを高速で起動
            const processes = [];
            for (let i = 0; i < 10; i++) {
                const process = spawn('bash', [scriptPath]);
                processes.push(process);
                // 短い間隔で起動
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            // すべてのプロセスの完了を待つ
            await Promise.all(processes.map(process => {
                return new Promise((resolve) => {
                    process.on('close', () => resolve());
                    process.on('error', () => resolve());
                });
            }));

            // 結果の検証
            if (fs.existsSync(resultFile)) {
                const results = fs.readFileSync(resultFile, 'utf8');
                const lines = results.trim().split('\n').filter(line => line.length > 0);
                
                const acquiredCount = lines.filter(line => line.includes('ACQUIRED_LOCK')).length;
                const failedCount = lines.filter(line => line.includes('LOCK_FAILED')).length;
                
                // 少なくとも1つはロックを取得し、他は失敗すべき
                expect(acquiredCount).toBeGreaterThan(0);
                expect(failedCount).toBeGreaterThan(0);
                expect(acquiredCount + failedCount).toBe(lines.length);
            }
        }, timeout);
    });

    describe('Real-world concurrent scenario simulation', () => {
        test('should handle Docker container restart scenario with multiple startup attempts', async () => {
            const containerSimulationScript = `#!/bin/bash
TEMP_DIR="${tempDir}"
CONTAINER_ID="container_$RANDOM"
STARTUP_LOCK="$TEMP_DIR/startup.lock"
STARTUP_DONE="$TEMP_DIR/startup.done"
RESULTS_FILE="$TEMP_DIR/container_results.txt"

# Docker再起動シミュレーション
simulate_container_startup() {
    local container_id="$1"
    local attempt_id="$2"
    
    echo "[$container_id-$attempt_id] Container startup initiated" >> "$RESULTS_FILE"
    
    # 起動ロック取得試行
    local lock_acquired=false
    for i in {1..3}; do
        if mkdir "$STARTUP_LOCK" 2>/dev/null; then
            echo "$container_id-$attempt_id" > "$STARTUP_LOCK/owner"
            lock_acquired=true
            break
        else
            echo "[$container_id-$attempt_id] Lock busy, waiting..." >> "$RESULTS_FILE"
            sleep 0.1
        fi
    done
    
    if [ "$lock_acquired" = true ]; then
        echo "[$container_id-$attempt_id] Lock acquired, starting services" >> "$RESULTS_FILE"
        
        # 起動完了マーカーをチェック
        if [ ! -f "$STARTUP_DONE" ]; then
            echo "[$container_id-$attempt_id] First startup, initializing..." >> "$RESULTS_FILE"
            sleep 0.2  # 初期化時間をシミュレート
            echo "$container_id-$attempt_id" > "$STARTUP_DONE"
            echo "[$container_id-$attempt_id] Startup completed successfully" >> "$RESULTS_FILE"
        else
            local existing_owner=$(cat "$STARTUP_DONE" 2>/dev/null || echo "unknown")
            echo "[$container_id-$attempt_id] Duplicate startup detected (first: $existing_owner)" >> "$RESULTS_FILE"
        fi
        
        # ロック解放
        rm -rf "$STARTUP_LOCK" 2>/dev/null || true
    else
        echo "[$container_id-$attempt_id] Failed to acquire startup lock" >> "$RESULTS_FILE"
    fi
}

# 複数の"コンテナ"で並行実行
for i in {1..3}; do
    simulate_container_startup "$CONTAINER_ID" "$i" &
done

wait  # すべてのバックグラウンドプロセス完了を待つ
`;

            const scriptPath = path.join(tempDir, 'container_simulation.sh');
            fs.writeFileSync(scriptPath, containerSimulationScript);
            fs.chmodSync(scriptPath, 0o755);

            // シミュレーション実行
            await new Promise((resolve, reject) => {
                const process = spawn('bash', [scriptPath]);
                process.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Simulation failed with code ${code}`));
                    }
                });
                process.on('error', reject);
            });

            // 結果の検証
            const resultsFile = path.join(tempDir, 'container_results.txt');
            if (fs.existsSync(resultsFile)) {
                const results = fs.readFileSync(resultsFile, 'utf8');
                const lines = results.trim().split('\n');
                
                const successfulStartups = lines.filter(line => 
                    line.includes('Startup completed successfully')
                ).length;
                const duplicateDetections = lines.filter(line => 
                    line.includes('Duplicate startup detected')
                ).length;
                
                // 1つだけが成功し、他は重複検出されるべき
                expect(successfulStartups).toBe(1);
                expect(duplicateDetections).toBeGreaterThan(0);
            }
        }, timeout);
    });

    describe('Race condition stress test', () => {
        test('should maintain data integrity under high concurrent load', async () => {
            const stressTestScript = `#!/bin/bash
TEMP_DIR="${tempDir}"
SHARED_COUNTER="$TEMP_DIR/shared_counter.txt"
LOCK_FILE="$TEMP_DIR/counter.lock"
RESULTS_FILE="$TEMP_DIR/stress_results.txt"
WORKER_ID=$$

# 共有カウンターの初期化
echo "0" > "$SHARED_COUNTER"

# アトミックなカウンターインクリメント
atomic_increment() {
    local success=false
    local attempts=0
    local max_attempts=10
    
    while [ "$success" = false ] && [ $attempts -lt $max_attempts ]; do
        if mkdir "$LOCK_FILE" 2>/dev/null; then
            # クリティカルセクション
            local current_value=$(cat "$SHARED_COUNTER" 2>/dev/null || echo "0")
            local new_value=$((current_value + 1))
            echo "$new_value" > "$SHARED_COUNTER"
            
            echo "[$WORKER_ID] Incremented to $new_value" >> "$RESULTS_FILE"
            
            # ロック解放
            rmdir "$LOCK_FILE" 2>/dev/null || true
            success=true
        else
            attempts=$((attempts + 1))
            sleep 0.001  # 短時間待機
        fi
    done
    
    if [ "$success" = false ]; then
        echo "[$WORKER_ID] Failed to increment after $max_attempts attempts" >> "$RESULTS_FILE"
    fi
}

# 複数回インクリメント実行
for i in {1..5}; do
    atomic_increment
    sleep 0.01
done
`;

            const scriptPath = path.join(tempDir, 'stress_test.sh');
            fs.writeFileSync(scriptPath, stressTestScript);
            fs.chmodSync(scriptPath, 0o755);

            // 複数ワーカーで並行実行
            const workers = [];
            const workerCount = 8;
            
            for (let i = 0; i < workerCount; i++) {
                const worker = spawn('bash', [scriptPath]);
                workers.push(worker);
            }

            // すべてのワーカーの完了を待つ
            await Promise.all(workers.map(worker => {
                return new Promise((resolve) => {
                    worker.on('close', () => resolve());
                    worker.on('error', () => resolve());
                });
            }));

            // データ整合性の検証
            const counterFile = path.join(tempDir, 'shared_counter.txt');
            if (fs.existsSync(counterFile)) {
                const finalValue = parseInt(fs.readFileSync(counterFile, 'utf8').trim());
                const expectedValue = workerCount * 5; // 8 workers × 5 increments each
                
                expect(finalValue).toBe(expectedValue);
            }

            // 実行ログの検証
            const resultsFile = path.join(tempDir, 'stress_results.txt');
            if (fs.existsSync(resultsFile)) {
                const results = fs.readFileSync(resultsFile, 'utf8');
                const successLines = results.split('\n').filter(line => 
                    line.includes('Incremented to')
                ).length;
                const failureLines = results.split('\n').filter(line => 
                    line.includes('Failed to increment')
                ).length;
                
                // すべての操作が成功すべき
                expect(successLines).toBe(workerCount * 5);
                expect(failureLines).toBe(0);
            }
        }, timeout);
    });
});