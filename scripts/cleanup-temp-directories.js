#!/usr/bin/env node

/**
 * temp-*ディレクトリのクリーンアップスクリプト
 * CIや開発環境でのテスト後のクリーンアップに使用
 */

const fs = require('fs');
const path = require('path');

class TempDirectoryCleanup {
  constructor(options = {}) {
    this.rootPath = options.rootPath || process.cwd();
    this.maxDepth = options.maxDepth || 3;
    this.dryRun = options.dryRun || false;
    this.verbose = options.verbose || false;
  }

  /**
   * temp-*パターンにマッチするディレクトリを検索
   * @param {string} dir - 検索するディレクトリ
   * @param {number} depth - 現在の深度
   * @returns {string[]} - 見つかったtemp-*ディレクトリのパス
   */
  findTempDirectories(dir, depth = 0) {
    const tempDirs = [];
    
    if (depth > this.maxDepth) {
      return tempDirs;
    }

    try {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const itemPath = path.join(dir, item);
        
        try {
          const stats = fs.statSync(itemPath);
          
          if (stats.isDirectory()) {
            // temp-*パターンにマッチする場合
            if (item.startsWith('temp-')) {
              tempDirs.push(itemPath);
              if (this.verbose) {
                console.log(`Found temp directory: ${itemPath}`);
              }
            }
            // .tmpディレクトリもチェック
            else if (item === '.tmp') {
              tempDirs.push(itemPath);
              if (this.verbose) {
                console.log(`Found .tmp directory: ${itemPath}`);
              }
            }
            // node_modulesや.gitディレクトリは除外
            else if (item !== 'node_modules' && item !== '.git' && !item.startsWith('.')) {
              tempDirs.push(...this.findTempDirectories(itemPath, depth + 1));
            }
          }
        } catch (error) {
          // 権限エラーなどは無視
          if (this.verbose) {
            console.warn(`Warning: Could not access ${itemPath}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      if (this.verbose) {
        console.warn(`Warning: Could not read directory ${dir}: ${error.message}`);
      }
    }

    return tempDirs;
  }

  /**
   * ディレクトリを削除
   * @param {string} dirPath - 削除するディレクトリのパス
   * @returns {boolean} - 削除成功したかどうか
   */
  removeDirectory(dirPath) {
    try {
      if (this.dryRun) {
        console.log(`[DRY RUN] Would remove: ${dirPath}`);
        return true;
      }

      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`Removed: ${dirPath}`);
      return true;
    } catch (error) {
      console.error(`Error removing ${dirPath}: ${error.message}`);
      return false;
    }
  }

  /**
   * クリーンアップ実行
   * @returns {Object} - クリーンアップの結果
   */
  cleanup() {
    console.log(`=== Temp Directory Cleanup Started ===`);
    console.log(`Root path: ${this.rootPath}`);
    console.log(`Max depth: ${this.maxDepth}`);
    console.log(`Dry run: ${this.dryRun}`);
    
    const tempDirs = this.findTempDirectories(this.rootPath);
    
    if (tempDirs.length === 0) {
      console.log('No temp directories found');
      return { total: 0, removed: 0, errors: 0 };
    }

    console.log(`Found ${tempDirs.length} temp directories:`);
    tempDirs.forEach(dir => console.log(`  - ${dir}`));

    let removed = 0;
    let errors = 0;

    for (const tempDir of tempDirs) {
      if (this.removeDirectory(tempDir)) {
        removed++;
      } else {
        errors++;
      }
    }

    const result = {
      total: tempDirs.length,
      removed: removed,
      errors: errors
    };

    console.log(`=== Cleanup completed ===`);
    console.log(`Total: ${result.total}, Removed: ${result.removed}, Errors: ${result.errors}`);
    
    return result;
  }
}

// コマンドライン引数の処理
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--max-depth' || arg === '-m') {
      options.maxDepth = parseInt(args[++i]) || 3;
    } else if (arg === '--root' || arg === '-r') {
      options.rootPath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node cleanup-temp-directories.js [options]

Options:
  --dry-run, -d     Show what would be removed without actually removing
  --verbose, -v     Show detailed output
  --max-depth, -m   Maximum depth to search (default: 3)
  --root, -r        Root directory to start search from (default: current directory)
  --help, -h        Show this help message
`);
      process.exit(0);
    }
  }

  return options;
}

// メイン処理
if (require.main === module) {
  const options = parseArgs();
  const cleanup = new TempDirectoryCleanup(options);
  const result = cleanup.cleanup();
  
  // 処理結果に基づいて終了コードを設定
  process.exit(result.errors > 0 ? 1 : 0);
}

module.exports = TempDirectoryCleanup;