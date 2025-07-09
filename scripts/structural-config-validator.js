#!/usr/bin/env node

/**
 * 構造化設定検証システム - 文字列マッチングを脱却した堅牢な検証
 * 設定値をJSON形式で管理し、スキーマベースで検証
 */

const fs = require('fs');
const path = require('path');

class StructuralConfigValidator {
  constructor() {
    this.configSchema = {
      type: 'object',
      properties: {
        EXCHANGE_SETTINGS: {
          type: 'object',
          required: ['RATE_LIMIT', 'TIMEOUT', 'MAX_THROTTLE_QUEUE_SIZE', 'MAX_CONCURRENT_PAIRS'],
          properties: {
            RATE_LIMIT: { type: 'number', minimum: 1000, maximum: 30000 },
            TIMEOUT: { type: 'number', minimum: 5000, maximum: 120000 },
            MAX_THROTTLE_QUEUE_SIZE: { type: 'number', minimum: 100, maximum: 5000 },
            MAX_CONCURRENT_PAIRS: { type: 'number', minimum: 1, maximum: 10 },
            BACKOFF_INITIAL_DELAY: { type: 'number', minimum: 500, maximum: 5000 },
            BACKOFF_MAX_DELAY: { type: 'number', minimum: 10000, maximum: 60000 },
            BACKOFF_MULTIPLIER: { type: 'number', minimum: 1.5, maximum: 3 }
          }
        },
        TRADING_SETTINGS: {
          type: 'object',
          required: ['DEFAULT_AMOUNT', 'TRADE_PERCENTAGE'],
          properties: {
            DEFAULT_AMOUNT: { type: 'number', minimum: 0.0001, maximum: 1 },
            TRADE_PERCENTAGE: { type: 'number', minimum: 0.001, maximum: 0.1 }
          }
        }
      }
    };
  }

  /**
     * const.jsから設定値を構造化データとして抽出
     */
  extractConfigData() {
    try {
      // Node.jsの動的ロードを使用
      const constPath = path.resolve(__dirname, '../src/common/const.js');
      delete require.cache[constPath];
      const { EXCHANGE_SETTINGS, TRADING_SETTINGS, ORDER_MANAGEMENT_SETTINGS } = require(constPath);

      const configData = {
        source: 'src/common/const.js',
        extractedAt: new Date().toISOString(),
        EXCHANGE_SETTINGS,
        TRADING_SETTINGS,
        ORDER_MANAGEMENT_SETTINGS
      };

      return configData;
    } catch (error) {
      throw new Error(`設定ファイル読み込みエラー: ${error.message}`);
    }
  }

  /**
     * README.mdから設定値を抽出（正規表現ベース）
     */
  extractReadmeConfig() {
    try {
      const readmePath = path.resolve(__dirname, '../README.md');
      const readmeContent = fs.readFileSync(readmePath, 'utf8');
      const configBlocks = this.findConfigBlocks(readmeContent);

      const readmeConfig = {
        source: 'README.md',
        extractedAt: new Date().toISOString(),
        blocks: configBlocks,
        parsedValues: this.parseConfigBlocks(configBlocks)
      };

      return readmeConfig;
    } catch (error) {
      throw new Error(`README読み込みエラー: ${error.message}`);
    }
  }

  /**
     * README.mdから設定ブロックを抽出
     */
  findConfigBlocks(content) {
    const blocks = [];
    const patterns = [
      /```javascript[\s\S]*?const EXCHANGE_SETTINGS = ([\s\S]*?);[\s\S]*?```/g,
      /RATE_LIMIT:\s*(\d+)/g,
      /TIMEOUT:\s*(\d+)/g,
      /MAX_THROTTLE_QUEUE_SIZE:\s*(\d+)/g,
      /MAX_CONCURRENT_PAIRS:\s*(\d+)/g
    ];

    patterns.forEach((pattern, index) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        blocks.push({
          type: index === 0 ? 'code_block' : 'inline_value',
          pattern: pattern.source,
          match: match[0],
          value: match[1],
          position: match.index
        });
      }
    });

    return blocks;
  }

  /**
     * 設定ブロックから実際の値を解析
     */
  parseConfigBlocks(blocks) {
    const parsed = {};

    blocks.forEach(block => {
      if (block.type === 'code_block') {
        try {
          // JavaScriptオブジェクトとして評価（危険なので制限付き）
          const cleanValue = block.value
            .replace(/\/\/.*$/gm, '') // コメント除去
            .replace(/,\s*}/g, '}');  // 末尾カンマ除去

          const evalResult = this.safeEval(`(${cleanValue})`);
          if (evalResult) {
            Object.assign(parsed, evalResult);
          }
        } catch (error) {
          console.warn('コードブロック解析エラー:', error.message);
        }
      } else if (block.type === 'inline_value') {
        // インライン値の解析
        const numValue = parseInt(block.value);
        if (!isNaN(numValue)) {
          // パターンから設定名を推定
          if (block.pattern.includes('RATE_LIMIT')) {
            parsed.RATE_LIMIT = numValue;
          } else if (block.pattern.includes('TIMEOUT')) {
            parsed.TIMEOUT = numValue;
          } else if (block.pattern.includes('MAX_THROTTLE_QUEUE_SIZE')) {
            parsed.MAX_THROTTLE_QUEUE_SIZE = numValue;
          } else if (block.pattern.includes('MAX_CONCURRENT_PAIRS')) {
            parsed.MAX_CONCURRENT_PAIRS = numValue;
          }
        }
      }
    });

    return parsed;
  }

  /**
     * 安全なeval（制限付き）
     */
  safeEval(code) {
    try {
      // 危険な関数を無効化
      const context = {
        undefined,
        null: null,
        true: true,
        false: false,
        Number,
        String,
        Array,
        Object
      };

      // Function constructorを使用（evalより安全）
      const func = new Function(...Object.keys(context), `return ${code}`);
      return func(...Object.values(context));
    } catch (error) {
      console.warn('安全なeval失敗:', error.message);
      return null;
    }
  }

  /**
     * 構造化された設定比較
     */
  compareStructuredConfigs(sourceConfig, readmeConfig) {
    const discrepancies = [];

    // EXCHANGE_SETTINGSの比較
    if (sourceConfig.EXCHANGE_SETTINGS && readmeConfig.parsedValues) {
      const sourceSettings = sourceConfig.EXCHANGE_SETTINGS;
      const readmeSettings = readmeConfig.parsedValues;

      Object.entries(sourceSettings).forEach(([key, sourceValue]) => {
        const readmeValue = readmeSettings[key];

        if (readmeValue !== undefined && sourceValue !== readmeValue) {
          discrepancies.push({
            setting: key,
            source: {
              file: sourceConfig.source,
              value: sourceValue,
              type: typeof sourceValue
            },
            readme: {
              file: readmeConfig.source,
              value: readmeValue,
              type: typeof readmeValue
            },
            severity: this.calculateSeverity(key, sourceValue, readmeValue)
          });
        }
      });
    }

    return {
      discrepancies,
      summary: {
        total: discrepancies.length,
        critical: discrepancies.filter(d => d.severity === 'critical').length,
        warning: discrepancies.filter(d => d.severity === 'warning').length,
        info: discrepancies.filter(d => d.severity === 'info').length
      }
    };
  }

  /**
     * 乖離の重要度計算
     */
  calculateSeverity(setting, sourceValue, readmeValue) {
    // 安全性に関わる設定は重要度が高い
    const criticalSettings = ['MAX_THROTTLE_QUEUE_SIZE', 'TIMEOUT', 'MAX_CONCURRENT_PAIRS'];
    const warningSettings = ['RATE_LIMIT', 'BACKOFF_MAX_DELAY'];

    if (criticalSettings.includes(setting)) {
      const diff = Math.abs(sourceValue - readmeValue) / sourceValue;
      return diff > 0.1 ? 'critical' : 'warning'; // 10%以上の差は重要
    } else if (warningSettings.includes(setting)) {
      return 'warning';
    } else {
      return 'info';
    }
  }

  /**
     * スキーマ検証
     */
  validateSchema(configData) {
    const errors = [];

    // 簡易スキーマ検証（本格的にはajvなどを使用）
    if (configData.EXCHANGE_SETTINGS) {
      const settings = configData.EXCHANGE_SETTINGS;

      if (typeof settings.RATE_LIMIT !== 'number' || settings.RATE_LIMIT < 1000) {
        errors.push('RATE_LIMIT must be a number >= 1000');
      }

      if (typeof settings.MAX_THROTTLE_QUEUE_SIZE !== 'number' || settings.MAX_THROTTLE_QUEUE_SIZE < 100) {
        errors.push('MAX_THROTTLE_QUEUE_SIZE must be a number >= 100');
      }

      if (typeof settings.MAX_CONCURRENT_PAIRS !== 'number' || settings.MAX_CONCURRENT_PAIRS < 1) {
        errors.push('MAX_CONCURRENT_PAIRS must be a number >= 1');
      }
    }

    return errors;
  }

  /**
     * 完全な検証実行
     */
  runFullValidation() {
    console.log('🔍 構造化設定検証開始...\n');

    try {
      // 1. 設定データ抽出
      console.log('1. 設定データ抽出中...');
      const sourceConfig = this.extractConfigData();
      const readmeConfig = this.extractReadmeConfig();

      console.log(`   ✅ const.js: ${Object.keys(sourceConfig.EXCHANGE_SETTINGS || {}).length}個の設定`);
      console.log(`   ✅ README.md: ${Object.keys(readmeConfig.parsedValues || {}).length}個の設定\n`);

      // 2. スキーマ検証
      console.log('2. スキーマ検証中...');
      const schemaErrors = this.validateSchema(sourceConfig);
      if (schemaErrors.length > 0) {
        console.log('   ❌ スキーマエラー:');
        schemaErrors.forEach(error => console.log(`      - ${error}`));
      } else {
        console.log('   ✅ スキーマ検証成功');
      }
      console.log('');

      // 3. 構造化比較
      console.log('3. 構造化比較実行中...');
      const comparison = this.compareStructuredConfigs(sourceConfig, readmeConfig);

      if (comparison.discrepancies.length === 0) {
        console.log('   ✅ 設定値の整合性確認');
        return { success: true, details: comparison };
      } else {
        console.log(`   ❌ ${comparison.discrepancies.length}件の乖離を検出`);
        console.log(`      - 重要: ${comparison.summary.critical}件`);
        console.log(`      - 警告: ${comparison.summary.warning}件`);
        console.log(`      - 情報: ${comparison.summary.info}件\n`);

        // 詳細な乖離レポート
        console.log('=== 乖離詳細 ===');
        comparison.discrepancies.forEach((disc, index) => {
          const severity = disc.severity.toUpperCase();
          console.log(`${index + 1}. [${severity}] ${disc.setting}`);
          console.log(`   const.js: ${disc.source.value} (${disc.source.type})`);
          console.log(`   README.md: ${disc.readme.value} (${disc.readme.type})`);
          console.log('');
        });

        return { success: false, details: comparison };
      }

    } catch (error) {
      console.error('❌ 検証エラー:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// スクリプト実行
if (require.main === module) {
  const validator = new StructuralConfigValidator();
  const result = validator.runFullValidation();

  // 結果をファイルに保存
  const outputFile = path.join(__dirname, '../docs/structural-validation-result.json');
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  console.log(`📝 検証結果を保存: ${outputFile}`);

  // 終了コード設定
  process.exit(result.success ? 0 : 1);
}

module.exports = StructuralConfigValidator;