/**
 * Temporary Path Helper
 * テスト用一時ファイルパス生成ヘルパー
 * 
 * Issue #5405対応: /tmpから.tmpディレクトリへの移行
 * 並行実行時の競合防止とテストの安全性向上
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// プロジェクトルートディレクトリ
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// .tmpディレクトリのパス
const TMP_DIR = path.join(PROJECT_ROOT, '.tmp');

// サポートするサブディレクトリ
const SUPPORTED_SUBDIRS = {
  locks: 'locks',     // ロックファイル用
  logs: 'logs',       // ログファイル用 
  tests: 'tests',     // テスト用一時ファイル
  scripts: 'scripts', // スクリプト用一時ファイル
  backtest: 'backtest', // バックテスト用
  monitoring: 'monitoring' // 監視用
};

/**
 * 一時ファイルパスを生成する
 * @param {string} subdir - サブディレクトリ名 (locks, logs, tests, scripts, backtest, monitoring)
 * @param {string} filename - ファイル名
 * @param {Object} options - オプション
 * @param {boolean} options.unique - ユニークなファイル名を生成するか (デフォルト: true)
 * @param {string} options.prefix - ファイル名のプレフィックス
 * @returns {string} 生成されたファイルパス
 */
function getTempPath(subdir, filename, options = {}) {
  const { unique = true, prefix = '' } = options;
  
  if (!SUPPORTED_SUBDIRS[subdir]) {
    throw new Error(`Unsupported subdirectory: ${subdir}. Supported: ${Object.keys(SUPPORTED_SUBDIRS).join(', ')}`);
  }
  
  // .tmpディレクトリが存在しない場合は作成
  const subdirPath = path.join(TMP_DIR, SUPPORTED_SUBDIRS[subdir]);
  if (!fs.existsSync(subdirPath)) {
    fs.mkdirSync(subdirPath, { recursive: true });
  }
  
  let finalFilename = filename;
  
  if (unique) {
    // ユニークなファイル名を生成 (プロセスID + タイムスタンプ + ランダム文字列)
    const processId = process.pid;
    const timestamp = Date.now();
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);
    
    finalFilename = `${prefix}${basename}-${processId}-${timestamp}-${randomSuffix}${ext}`;
  } else if (prefix) {
    finalFilename = `${prefix}${filename}`;
  }
  
  return path.join(subdirPath, finalFilename);
}

/**
 * 一時ディレクトリを生成する
 * @param {string} subdir - サブディレクトリ名
 * @param {string} dirPrefix - ディレクトリ名のプレフィックス
 * @returns {string} 生成されたディレクトリパス
 */
function getTempDir(subdir, dirPrefix = 'tmp') {
  if (!SUPPORTED_SUBDIRS[subdir]) {
    throw new Error(`Unsupported subdirectory: ${subdir}. Supported: ${Object.keys(SUPPORTED_SUBDIRS).join(', ')}`);
  }
  
  const processId = process.pid;
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  
  const dirName = `${dirPrefix}-${processId}-${timestamp}-${randomSuffix}`;
  const fullPath = path.join(TMP_DIR, SUPPORTED_SUBDIRS[subdir], dirName);
  
  fs.mkdirSync(fullPath, { recursive: true });
  
  return fullPath;
}

/**
 * fs.mkdtempSyncの.tmp版
 * @param {string} subdir - サブディレクトリ名
 * @param {string} template - テンプレート文字列 (例: 'backtest-test-')
 * @returns {string} 作成されたディレクトリパス
 */
function mkdtempSync(subdir, template) {
  if (!SUPPORTED_SUBDIRS[subdir]) {
    throw new Error(`Unsupported subdirectory: ${subdir}. Supported: ${Object.keys(SUPPORTED_SUBDIRS).join(', ')}`);
  }
  
  const subdirPath = path.join(TMP_DIR, SUPPORTED_SUBDIRS[subdir]);
  if (!fs.existsSync(subdirPath)) {
    fs.mkdirSync(subdirPath, { recursive: true });
  }
  
  return fs.mkdtempSync(path.join(subdirPath, template));
}

/**
 * 一時ファイル・ディレクトリのクリーンアップ
 * @param {string} targetPath - クリーンアップ対象のパス
 */
function cleanup(targetPath) {
  try {
    if (fs.existsSync(targetPath)) {
      const stats = fs.statSync(targetPath);
      if (stats.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(targetPath);
      }
    }
  } catch (error) {
    // エラーは無視（他のプロセスが既に削除している可能性）
    console.warn(`Cleanup warning for ${targetPath}:`, error.message);
  }
}

/**
 * 古い一時ファイルのクリーンアップ
 * @param {string} subdir - サブディレクトリ名
 * @param {number} maxAgeMs - 最大保持時間（ミリ秒）
 */
function cleanupOldFiles(subdir, maxAgeMs = 24 * 60 * 60 * 1000) { // デフォルト24時間
  if (!SUPPORTED_SUBDIRS[subdir]) {
    return;
  }
  
  const subdirPath = path.join(TMP_DIR, SUPPORTED_SUBDIRS[subdir]);
  if (!fs.existsSync(subdirPath)) {
    return;
  }
  
  const now = Date.now();
  const files = fs.readdirSync(subdirPath);
  
  files.forEach(file => {
    const filePath = path.join(subdirPath, file);
    try {
      const stats = fs.statSync(filePath);
      if (now - stats.mtime.getTime() > maxAgeMs) {
        cleanup(filePath);
      }
    } catch (error) {
      // ファイルが既に削除されている等
    }
  });
}

module.exports = {
  getTempPath,
  getTempDir, 
  mkdtempSync,
  cleanup,
  cleanupOldFiles,
  TMP_DIR,
  SUPPORTED_SUBDIRS
};