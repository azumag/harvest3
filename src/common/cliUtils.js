/**
 * 共通CLI ユーティリティ
 * similarity-ts分析で80%+の類似度を持つ引数解析機能を統合
 */

const fs = require('fs');
const path = require('path');

class CLIUtils {
  constructor() {
    this.scriptName = path.basename(process.argv[1], '.js');
  }

  /**
   * スクリプト引数を構造化された形式で解析
   */
  parseScriptArguments(schema = {}) {
    const args = process.argv.slice(2);
    const parsed = {
      options: {},
      flags: {},
      positional: [],
      errors: []
    };

    // デフォルトのスキーマ設定
    const defaultSchema = {
      help: { type: 'flag', alias: 'h', description: 'Show help message' },
      verbose: { type: 'flag', alias: 'v', description: 'Verbose output' },
      dryRun: { type: 'flag', alias: 'd', description: 'Dry run mode' },
      config: { type: 'option', alias: 'c', description: 'Configuration file path' }
    };

    const finalSchema = { ...defaultSchema, ...schema };

    // エイリアスマップを作成
    const aliasMap = {};
    for (const [key, config] of Object.entries(finalSchema)) {
      if (config.alias) {
        aliasMap[config.alias] = key;
      }
    }

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg.startsWith('--')) {
        // 長いオプション形式 (--option=value または --flag)
        const [optionName, ...valueParts] = arg.slice(2).split('=');
        const value = valueParts.join('=') || null;

        if (finalSchema[optionName]) {
          if (finalSchema[optionName].type === 'flag') {
            parsed.flags[optionName] = true;
          } else if (finalSchema[optionName].type === 'option') {
            if (value !== null) {
              parsed.options[optionName] = value;
            } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
              parsed.options[optionName] = args[++i];
            } else {
              parsed.errors.push(`Option --${optionName} requires a value`);
            }
          }
        } else {
          parsed.errors.push(`Unknown option: --${optionName}`);
        }
      } else if (arg.startsWith('-') && arg.length > 1) {
        // 短いオプション形式 (-o value または -f)
        const shortName = arg.slice(1);
        const fullName = aliasMap[shortName];

        if (fullName && finalSchema[fullName]) {
          if (finalSchema[fullName].type === 'flag') {
            parsed.flags[fullName] = true;
          } else if (finalSchema[fullName].type === 'option') {
            if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
              parsed.options[fullName] = args[++i];
            } else {
              parsed.errors.push(`Option -${shortName} requires a value`);
            }
          }
        } else {
          parsed.errors.push(`Unknown option: -${shortName}`);
        }
      } else {
        // 位置引数
        parsed.positional.push(arg);
      }
    }

    // バリデーション
    this.validateArguments(parsed, finalSchema);

    // ヘルプが要求された場合
    if (parsed.flags.help) {
      this.showHelp(finalSchema);
      process.exit(0);
    }

    return parsed;
  }

  /**
   * 引数のバリデーション
   */
  validateArguments(parsed, schema) {
    for (const [key, config] of Object.entries(schema)) {
      // 必須チェック
      if (config.required) {
        const hasValue = (config.type === 'flag' && parsed.flags[key]) ||
                        (config.type === 'option' && parsed.options[key] !== undefined);

        if (!hasValue) {
          parsed.errors.push(`Required ${config.type} --${key} is missing`);
        }
      }

      // 型チェック
      if (config.type === 'option' && parsed.options[key] !== undefined) {
        if (config.dataType === 'number') {
          const num = Number(parsed.options[key]);
          if (isNaN(num)) {
            parsed.errors.push(`Option --${key} must be a number`);
          } else {
            parsed.options[key] = num;
          }
        } else if (config.dataType === 'boolean') {
          const val = parsed.options[key].toLowerCase();
          if (!['true', 'false', '1', '0', 'yes', 'no'].includes(val)) {
            parsed.errors.push(`Option --${key} must be a boolean value`);
          } else {
            parsed.options[key] = ['true', '1', 'yes'].includes(val);
          }
        }
      }

      // 値の範囲チェック
      if (config.choices && parsed.options[key] !== undefined) {
        if (!config.choices.includes(parsed.options[key])) {
          parsed.errors.push(`Option --${key} must be one of: ${config.choices.join(', ')}`);
        }
      }

      // ファイル存在チェック
      if (config.mustExist && parsed.options[key] !== undefined) {
        if (!fs.existsSync(parsed.options[key])) {
          parsed.errors.push(`File does not exist: ${parsed.options[key]}`);
        }
      }
    }
  }

  /**
   * ヘルプメッセージを表示
   */
  showHelp(schema, description = null) {
    console.log(`\n使用法: node ${this.scriptName}.js [OPTIONS] [ARGS...]\n`);

    if (description) {
      console.log(`${description}\n`);
    }

    console.log('オプション:');

    const maxKeyLength = Math.max(...Object.keys(schema).map(k => k.length));

    for (const [key, config] of Object.entries(schema)) {
      const shortForm = config.alias ? `-${config.alias}, ` : '    ';
      const longForm = `--${key}`.padEnd(maxKeyLength + 2);
      const required = config.required ? ' (必須)' : '';
      const dataType = config.dataType ? ` <${config.dataType}>` : '';
      const choices = config.choices ? ` [${config.choices.join('|')}]` : '';

      console.log(`  ${shortForm}${longForm}${dataType}${choices}${required}`);

      if (config.description) {
        console.log(`      ${config.description}`);
      }

      if (config.default !== undefined) {
        console.log(`      デフォルト: ${config.default}`);
      }

      console.log('');
    }
  }

  /**
   * エラーメッセージの表示と終了
   */
  handleErrors(parsed, exitOnError = true) {
    if (parsed.errors.length > 0) {
      console.error('\n❌ エラー:');
      parsed.errors.forEach(error => {
        console.error(`  ${error}`);
      });
      console.error(`\nヘルプを表示するには: node ${this.scriptName}.js --help\n`);

      if (exitOnError) {
        process.exit(1);
      }
      return false;
    }
    return true;
  }

  /**
   * 設定ファイルの読み込み
   */
  loadConfigFile(configPath, defaultConfig = {}) {
    try {
      if (!fs.existsSync(configPath)) {
        console.warn(`⚠️ 設定ファイルが見つかりません: ${configPath}`);
        return defaultConfig;
      }

      const ext = path.extname(configPath).toLowerCase();
      let config;

      if (ext === '.json') {
        const content = fs.readFileSync(configPath, 'utf8');
        config = JSON.parse(content);
      } else if (ext === '.js') {
        config = require(path.resolve(configPath));
      } else {
        throw new Error(`Unsupported config file format: ${ext}`);
      }

      console.log(`✅ 設定ファイルを読み込みました: ${configPath}`);
      return { ...defaultConfig, ...config };

    } catch (error) {
      console.error(`❌ 設定ファイル読み込みエラー: ${error.message}`);
      return defaultConfig;
    }
  }

  /**
   * 進捗バーの表示
   */
  createProgressBar(total, description = 'Progress') {
    let current = 0;
    const barLength = 40;

    const update = (increment = 1) => {
      current += increment;
      const percentage = Math.round((current / total) * 100);
      const filledLength = Math.round((current / total) * barLength);
      const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

      process.stdout.write(`\r${description}: [${bar}] ${current}/${total} (${percentage}%)`);

      if (current >= total) {
        console.log(''); // 改行
      }
    };

    return { update };
  }

  /**
   * 確認プロンプト
   */
  async askConfirmation(question, defaultAnswer = false) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const defaultText = defaultAnswer ? '[Y/n]' : '[y/N]';
    const answer = await new Promise(resolve => {
      rl.question(`${question} ${defaultText}: `, resolve);
    });

    rl.close();

    if (answer.trim() === '') {
      return defaultAnswer;
    }

    return ['y', 'yes', '1', 'true'].includes(answer.toLowerCase().trim());
  }

  /**
   * タイムスタンプ付きログ
   */
  logWithTimestamp(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const levelColors = {
      error: '\x1b[31m',   // 赤
      warn: '\x1b[33m',    // 黄
      info: '\x1b[32m',    // 緑
      debug: '\x1b[36m'    // シアン
    };
    const reset = '\x1b[0m';
    const color = levelColors[level] || '';

    console.log(`${color}[${timestamp}] ${level.toUpperCase()}:${reset} ${message}`, ...args);
  }

  /**
   * スクリプト実行時間の測定
   */
  createTimer() {
    const startTime = Date.now();

    return {
      elapsed: () => Date.now() - startTime,
      elapsedFormatted: () => {
        const elapsed = Date.now() - startTime;
        if (elapsed < 1000) {
          return `${elapsed}ms`;
        } else if (elapsed < 60000) {
          return `${(elapsed / 1000).toFixed(2)}s`;
        } else {
          const minutes = Math.floor(elapsed / 60000);
          const seconds = ((elapsed % 60000) / 1000).toFixed(2);
          return `${minutes}m ${seconds}s`;
        }
      }
    };
  }
}

/**
 * 便利な静的メソッド
 */
CLIUtils.quickParse = function(schema, description = null) {
  const cli = new CLIUtils();
  const parsed = cli.parseScriptArguments(schema);

  if (!cli.handleErrors(parsed)) {
    return null;
  }

  return {
    ...parsed.options,
    ...parsed.flags,
    positional: parsed.positional,
    cli // CLIUtilsインスタンスも返す
  };
};

module.exports = { CLIUtils };