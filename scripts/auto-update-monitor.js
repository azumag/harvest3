const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

/**
 * mainブランチ自動更新監視システム
 * - mainブランチの更新を定期的にチェック
 * - 更新検出時にgit pullとDockerサービス再起動を実行
 */
class AutoUpdateMonitor {
    constructor(config = {}) {
        this.config = {
            // チェック間隔（デフォルト: 5分）
            checkIntervalMs: config.checkIntervalMs || 5 * 60 * 1000,
            // gitリモートブランチ
            remoteBranch: config.remoteBranch || 'origin/main',
            // ローカルブランチ
            localBranch: config.localBranch || 'main',
            // Dockerサービス
            dockerServices: config.dockerServices || ['backtest', 'bot'],
            // デバッグモード
            debug: config.debug || false,
            // 最大リトライ回数
            maxRetries: config.maxRetries || 3,
            // リトライ間隔（ミリ秒）
            retryDelayMs: config.retryDelayMs || 10000
        };
        
        this.isRunning = false;
        this.intervalId = null;
        this.lastKnownHash = null;
    }

    /**
     * 監視を開始
     */
    start() {
        if (this.isRunning) {
            console.log('🔄 自動更新監視は既に実行中です');
            return;
        }

        console.log(`🚀 mainブランチ自動更新監視を開始 (間隔: ${this.config.checkIntervalMs / 1000}秒)`);
        this.isRunning = true;

        // 初回チェック
        this.checkForUpdates();

        // 定期チェック設定
        this.intervalId = setInterval(() => {
            this.checkForUpdates();
        }, this.config.checkIntervalMs);

        // グレースフルシャットダウン
        process.on('SIGINT', () => this.stop());
        process.on('SIGTERM', () => this.stop());
    }

    /**
     * 監視を停止
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        console.log('\n🛑 自動更新監視を停止中...');
        this.isRunning = false;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        console.log('✅ 自動更新監視を停止しました');
        process.exit(0);
    }

    /**
     * 更新をチェック
     */
    async checkForUpdates() {
        try {
            if (this.config.debug) {
                console.log(`🔍 [${new Date().toLocaleString()}] mainブランチの更新をチェック中...`);
            }

            // リモートの最新情報を取得
            await this.executeCommand('git', ['fetch', 'origin']);

            // リモートブランチの最新ハッシュを取得
            const remoteHash = await this.getCommitHash(this.config.remoteBranch);
            
            // ローカルブランチの現在のハッシュを取得
            const localHash = await this.getCommitHash(this.config.localBranch);

            if (this.config.debug) {
                console.log(`📋 リモートハッシュ: ${remoteHash}`);
                console.log(`📋 ローカルハッシュ: ${localHash}`);
            }

            // 初回実行時はローカルハッシュを記録
            if (this.lastKnownHash === null) {
                this.lastKnownHash = localHash;
                console.log(`📝 初期ハッシュを記録: ${localHash.slice(0, 7)}`);
                return;
            }

            // 更新があるかチェック
            if (remoteHash !== localHash) {
                console.log(`🔄 mainブランチの更新を検出:`);
                console.log(`   旧: ${localHash.slice(0, 7)}`);
                console.log(`   新: ${remoteHash.slice(0, 7)}`);
                
                await this.performUpdate();
                this.lastKnownHash = remoteHash;
            } else {
                if (this.config.debug) {
                    console.log('✅ 更新なし');
                }
            }

        } catch (error) {
            console.error('❌ 更新チェック中にエラーが発生:', error.message);
            if (this.config.debug) {
                console.error(error);
            }
        }
    }

    /**
     * 更新を実行（git pull + Dockerサービス再起動）
     */
    async performUpdate() {
        let retryCount = 0;
        
        while (retryCount < this.config.maxRetries) {
            try {
                console.log(`🔄 [試行 ${retryCount + 1}/${this.config.maxRetries}] 自動更新を実行中...`);

                // git pullを実行
                console.log('📥 git pull を実行中...');
                await this.executeCommand('git', ['pull', 'origin', this.config.localBranch]);
                console.log('✅ git pull 完了');

                // Dockerサービスを再起動
                await this.restartDockerServices();
                
                console.log('🎉 自動更新が正常に完了しました');
                return;

            } catch (error) {
                retryCount++;
                console.error(`❌ 更新試行 ${retryCount} 失敗:`, error.message);
                
                if (retryCount >= this.config.maxRetries) {
                    console.error(`💥 最大リトライ回数 (${this.config.maxRetries}) に達しました`);
                    throw error;
                }
                
                console.log(`⏳ ${this.config.retryDelayMs / 1000}秒後にリトライします...`);
                await this.sleep(this.config.retryDelayMs);
            }
        }
    }

    /**
     * Dockerサービスを再起動
     */
    async restartDockerServices() {
        try {
            // Docker Composeが利用可能かチェック
            await this.executeCommand('docker', ['compose', 'version']);
            
            console.log('🛑 Dockerサービスを停止中...');
            await this.executeCommand('docker', ['compose', 'down']);
            console.log('✅ Dockerサービス停止完了');

            console.log(`🚀 Dockerサービスを起動中: ${this.config.dockerServices.join(', ')}`);
            const args = ['compose', 'up', '-d', ...this.config.dockerServices];
            await this.executeCommand('docker', args);
            console.log('✅ Dockerサービス起動完了');

        } catch (error) {
            console.error('❌ Dockerサービス再起動失敗:', error.message);
            throw error;
        }
    }

    /**
     * 指定されたブランチのコミットハッシュを取得
     */
    async getCommitHash(branch) {
        try {
            const result = await this.executeCommand('git', ['rev-parse', branch]);
            return result.trim();
        } catch (error) {
            throw new Error(`ブランチ ${branch} のハッシュ取得失敗: ${error.message}`);
        }
    }

    /**
     * コマンドを実行
     */
    executeCommand(command, args) {
        return new Promise((resolve, reject) => {
            const process = spawn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: path.resolve('.')
            });

            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`${command} ${args.join(' ')} failed: ${stderr}`));
                }
            });

            process.on('error', (error) => {
                reject(new Error(`コマンド実行エラー: ${error.message}`));
            });
        });
    }

    /**
     * 指定された時間待機
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 現在の状態を表示
     */
    async getStatus() {
        try {
            const localHash = await this.getCommitHash(this.config.localBranch);
            const remoteHash = await this.getCommitHash(this.config.remoteBranch);
            
            return {
                isRunning: this.isRunning,
                localHash: localHash.slice(0, 7),
                remoteHash: remoteHash.slice(0, 7),
                upToDate: localHash === remoteHash,
                checkInterval: this.config.checkIntervalMs / 1000,
                dockerServices: this.config.dockerServices
            };
        } catch (error) {
            return {
                error: error.message
            };
        }
    }
}

// CLIから実行された場合
if (require.main === module) {
    const config = {
        debug: process.argv.includes('--debug'),
        checkIntervalMs: process.argv.includes('--interval') ? 
            parseInt(process.argv[process.argv.indexOf('--interval') + 1]) * 1000 : 
            undefined,
        dockerServices: process.argv.includes('--services') ? 
            process.argv[process.argv.indexOf('--services') + 1].split(',') : 
            undefined
    };
    
    const monitor = new AutoUpdateMonitor(config);
    
    // statusコマンド
    if (process.argv.includes('--status')) {
        monitor.getStatus().then(status => {
            console.log('📊 自動更新監視ステータス:');
            console.log(JSON.stringify(status, null, 2));
        }).catch(error => {
            console.error('ステータス取得エラー:', error.message);
            process.exit(1);
        });
    } else {
        monitor.start();
    }
}

module.exports = AutoUpdateMonitor;