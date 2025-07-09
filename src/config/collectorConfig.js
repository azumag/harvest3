/**
 * 実データ収集システムの設定管理
 * 環境変数による外部化とバリデーション機能を提供
 */

const path = require('path');
const fs = require('fs');

class CollectorConfig {
  constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  /**
     * 環境変数とデフォルト値から設定を読み込み
     */
  loadConfig() {
    return {
      // データ収集設定
      collection: {
        interval: this.parseNumber(process.env.COLLECTION_INTERVAL, 60000, 1000, 3600000),
        dataRetentionDays: this.parseNumber(process.env.DATA_RETENTION_DAYS, 30, 1, 365),
        dataDir: process.env.DATA_DIR || path.join(__dirname, '../../data'),
        maxFileSize: this.parseNumber(process.env.MAX_FILE_SIZE_MB, 100, 10, 1000) * 1024 * 1024,
        backupInterval: this.parseNumber(process.env.BACKUP_INTERVAL_HOURS, 24, 1, 168) * 60 * 60 * 1000
      },

      // API設定
      api: {
        timeout: this.parseNumber(process.env.EXCHANGE_API_TIMEOUT, 10000, 1000, 60000),
        maxRetries: this.parseNumber(process.env.EXCHANGE_MAX_RETRIES, 3, 0, 10),
        retryDelay: this.parseNumber(process.env.EXCHANGE_RETRY_DELAY, 1000, 100, 10000),
        backoffMultiplier: this.parseNumber(process.env.EXCHANGE_BACKOFF_MULTIPLIER, 2, 1.1, 5),
        rateLimit: this.parseNumber(process.env.EXCHANGE_RATE_LIMIT, 5000, 1000, 30000)
      },

      // エラー閾値設定
      errorThresholds: {
        warning: this.parseNumber(process.env.ERROR_THRESHOLD_WARNING, 0.1, 0.01, 0.5),
        critical: this.parseNumber(process.env.ERROR_THRESHOLD_CRITICAL, 0.3, 0.1, 0.8)
      },

      // 監視設定
      monitoring: {
        enabled: this.parseBoolean(process.env.MONITORING_ENABLED, true),
        alertsEnabled: this.parseBoolean(process.env.ALERTS_ENABLED, true),
        metricsRetention: this.parseNumber(process.env.METRICS_RETENTION_COUNT, 1000, 100, 10000)
      },

      // セキュリティ設定
      security: {
        enableEncryption: this.parseBoolean(process.env.ENABLE_ENCRYPTION, false),
        logSensitiveData: this.parseBoolean(process.env.LOG_SENSITIVE_DATA, false),
        apiKeyMaskLength: this.parseNumber(process.env.API_KEY_MASK_LENGTH, 4, 0, 10)
      },

      // 負荷テスト設定
      loadTest: {
        enabled: this.parseBoolean(process.env.LOAD_TEST_ENABLED, false),
        scenarioDuration: this.parseNumber(process.env.LOAD_TEST_DURATION_MIN, 5, 1, 60) * 60 * 1000,
        dataPointTarget: this.parseNumber(process.env.LOAD_TEST_TARGET_POINTS, 1000, 100, 100000)
      },

      // 取引所設定
      exchanges: this.parseExchangeConfig()
    };
  }

  /**
     * 数値パース（範囲チェック付き）
     */
  parseNumber(value, defaultValue, min, max) {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      return defaultValue;
    }

    if (parsed < min || parsed > max) {
      console.warn(`設定値が範囲外: ${value} (範囲: ${min}-${max}). デフォルト値使用: ${defaultValue}`);
      return defaultValue;
    }

    return parsed;
  }

  /**
     * ブール値パース
     */
  parseBoolean(value, defaultValue) {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    return value.toLowerCase() === 'true' || value === '1';
  }

  /**
     * 取引所設定のパース
     */
  parseExchangeConfig() {
    const exchanges = {};

    // 環境変数から取引所リストを取得
    const exchangeList = (process.env.ENABLED_EXCHANGES || 'binance,bybit,okx').split(',');

    exchangeList.forEach(exchangeId => {
      const upperExchangeId = exchangeId.toUpperCase();
      exchanges[exchangeId] = {
        enabled: this.parseBoolean(process.env[`${upperExchangeId}_ENABLED`], true),
        apiKey: process.env[`${upperExchangeId}_API_KEY`] || '',
        apiSecret: process.env[`${upperExchangeId}_API_SECRET`] || '',
        testMode: this.parseBoolean(process.env[`${upperExchangeId}_TEST_MODE`], true),
        customRateLimit: this.parseNumber(
          process.env[`${upperExchangeId}_RATE_LIMIT`],
          null,
          1000,
          30000
        )
      };
    });

    return exchanges;
  }

  /**
     * 設定の妥当性検証
     */
  validateConfig() {
    const errors = [];

    // 基本的な検証
    if (this.config.collection.interval < 1000) {
      errors.push('収集間隔は最低1秒必要です');
    }

    if (this.config.errorThresholds.warning >= this.config.errorThresholds.critical) {
      errors.push('警告閾値は緊急閾値より低い必要があります');
    }

    // APIキーの検証（本番モードの場合）
    Object.entries(this.config.exchanges).forEach(([exchangeId, config]) => {
      if (config.enabled && !config.testMode && !config.apiKey) {
        errors.push(`${exchangeId}のAPIキーが設定されていません`);
      }
    });

    // データディレクトリの存在確認
    if (!fs.existsSync(this.config.collection.dataDir)) {
      try {
        fs.mkdirSync(this.config.collection.dataDir, { recursive: true });
        console.log(`データディレクトリを作成: ${this.config.collection.dataDir}`);
      } catch (error) {
        errors.push(`データディレクトリの作成に失敗: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      console.error('設定エラー:');
      errors.forEach(error => console.error(`  - ${error}`));
      throw new Error('設定検証に失敗しました');
    }
  }

  /**
     * 設定値の取得
     */
  get(path) {
    const keys = path.split('.');
    let value = this.config;

    for (const key of keys) {
      value = value[key];
      if (value === undefined) {
        return undefined;
      }
    }

    return value;
  }

  /**
     * 設定の動的更新
     */
  set(path, value) {
    const keys = path.split('.');
    let obj = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }

    obj[keys[keys.length - 1]] = value;
    this.validateConfig();
  }

  /**
     * 設定のエクスポート（機密情報をマスク）
     */
  exportSafeConfig() {
    const safeConfig = JSON.parse(JSON.stringify(this.config));

    // APIキーとシークレットをマスク
    Object.values(safeConfig.exchanges).forEach(exchange => {
      if (exchange.apiKey) {
        exchange.apiKey = this.maskString(exchange.apiKey);
      }
      if (exchange.apiSecret) {
        exchange.apiSecret = this.maskString(exchange.apiSecret);
      }
    });

    return safeConfig;
  }

  /**
     * 文字列のマスク処理
     */
  maskString(str) {
    if (!str || str.length <= this.config.security.apiKeyMaskLength * 2) {
      return '***';
    }

    const showLength = this.config.security.apiKeyMaskLength;
    return str.substring(0, showLength) +
               '***' +
               str.substring(str.length - showLength);
  }

  /**
     * 環境変数テンプレートの生成
     */
  generateEnvTemplate() {
    return `# 実データ収集システム設定
# 生成日時: ${new Date().toISOString()}

# === データ収集設定 ===
COLLECTION_INTERVAL=60000              # データ収集間隔（ミリ秒）
DATA_RETENTION_DAYS=30                 # データ保持期間（日）
DATA_DIR=./data                        # データ保存ディレクトリ
MAX_FILE_SIZE_MB=100                   # 最大ファイルサイズ（MB）
BACKUP_INTERVAL_HOURS=24               # バックアップ間隔（時間）

# === API設定 ===
EXCHANGE_API_TIMEOUT=10000             # APIタイムアウト（ミリ秒）
EXCHANGE_MAX_RETRIES=3                 # 最大リトライ回数
EXCHANGE_RETRY_DELAY=1000              # リトライ遅延（ミリ秒）
EXCHANGE_BACKOFF_MULTIPLIER=2          # バックオフ倍率
EXCHANGE_RATE_LIMIT=5000               # レート制限（ミリ秒）

# === エラー閾値設定 ===
ERROR_THRESHOLD_WARNING=0.1            # 警告閾値（0-1）
ERROR_THRESHOLD_CRITICAL=0.3           # 緊急閾値（0-1）

# === 監視設定 ===
MONITORING_ENABLED=true                # 監視機能の有効化
ALERTS_ENABLED=true                    # アラートの有効化
METRICS_RETENTION_COUNT=1000           # メトリクス保持数

# === セキュリティ設定 ===
ENABLE_ENCRYPTION=false                # データ暗号化
LOG_SENSITIVE_DATA=false               # 機密データのログ出力
API_KEY_MASK_LENGTH=4                  # APIキーマスク文字数

# === 負荷テスト設定 ===
LOAD_TEST_ENABLED=false                # 負荷テストモード
LOAD_TEST_DURATION_MIN=5               # テスト実行時間（分）
LOAD_TEST_TARGET_POINTS=1000           # 目標データポイント数

# === 取引所設定 ===
ENABLED_EXCHANGES=binance,bybit,okx    # 有効な取引所リスト

# Binance設定
BINANCE_ENABLED=true
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here
BINANCE_TEST_MODE=true
BINANCE_RATE_LIMIT=

# Bybit設定
BYBIT_ENABLED=true
BYBIT_API_KEY=your_api_key_here
BYBIT_API_SECRET=your_api_secret_here
BYBIT_TEST_MODE=true
BYBIT_RATE_LIMIT=

# OKX設定
OKX_ENABLED=true
OKX_API_KEY=your_api_key_here
OKX_API_SECRET=your_api_secret_here
OKX_TEST_MODE=true
OKX_RATE_LIMIT=
`;
  }

  /**
     * 設定サマリーの表示
     */
  displaySummary() {
    console.log('\n📋 実データ収集システム設定サマリー');
    console.log('=====================================');

    console.log('\n📊 データ収集:');
    console.log(`  収集間隔: ${this.config.collection.interval / 1000}秒`);
    console.log(`  保持期間: ${this.config.collection.dataRetentionDays}日`);
    console.log(`  データディレクトリ: ${this.config.collection.dataDir}`);

    console.log('\n🔌 API設定:');
    console.log(`  タイムアウト: ${this.config.api.timeout / 1000}秒`);
    console.log(`  最大リトライ: ${this.config.api.maxRetries}回`);
    console.log(`  レート制限: ${this.config.api.rateLimit / 1000}秒`);

    console.log('\n⚠️ エラー閾値:');
    console.log(`  警告: ${(this.config.errorThresholds.warning * 100).toFixed(0)}%`);
    console.log(`  緊急: ${(this.config.errorThresholds.critical * 100).toFixed(0)}%`);

    console.log('\n🏢 取引所:');
    Object.entries(this.config.exchanges).forEach(([id, config]) => {
      if (config.enabled) {
        console.log(`  ${id}: ${config.testMode ? 'テストモード' : '本番モード'}`);
      }
    });

    console.log('\n🔒 セキュリティ:');
    console.log(`  暗号化: ${this.config.security.enableEncryption ? '有効' : '無効'}`);
    console.log(`  機密ログ: ${this.config.security.logSensitiveData ? '有効' : '無効'}`);
  }
}

// シングルトンインスタンス
let instance = null;

module.exports = {
  /**
     * 設定インスタンスの取得
     */
  getInstance() {
    if (!instance) {
      instance = new CollectorConfig();
    }
    return instance;
  },

  /**
     * 設定のリロード
     */
  reload() {
    instance = new CollectorConfig();
    return instance;
  },

  /**
     * 環境変数テンプレートの生成
     */
  generateTemplate() {
    const config = new CollectorConfig();
    return config.generateEnvTemplate();
  }
};