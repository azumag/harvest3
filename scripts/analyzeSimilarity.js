const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity-js');

/**
 * コード類似度分析スクリプト
 * harvest3プロジェクトのJavaScriptファイルを分析し、類似度の高いコードを特定
 */

// 分析対象のディレクトリ
const TARGET_DIRS = [
  'src',
  'scripts'
];

// 除外パターン
const EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  'test',
  'coverage',
  '.env'
];

// 最小ファイルサイズ（バイト）
const MIN_FILE_SIZE = 100;

// 類似度閾値
const SIMILARITY_THRESHOLD = 0.7;

/**
 * ディレクトリを再帰的に走査してJSファイルを取得
 */
function getJSFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // 除外パターンチェック
      if (!EXCLUDE_PATTERNS.some(pattern => entry.name.includes(pattern))) {
        getJSFiles(fullPath, files);
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const stats = fs.statSync(fullPath);
      if (stats.size >= MIN_FILE_SIZE) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * ファイルからコメントと空行を除去した実質的なコードを抽出
 */
function extractCode(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // コメント除去（簡易版）
    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        // 空行、単行コメント、ブロックコメント（簡易）を除去
        return line.length > 0 &&
               !line.startsWith('//') &&
               !line.startsWith('/*') &&
               !line.startsWith('*') &&
               !line.startsWith('*/');
      });

    return lines.join('\n');
  } catch (error) {
    console.warn(`ファイル読み込みエラー: ${filePath}`, error.message);
    return '';
  }
}

/**
 * 関数レベルでのコード分析
 */
function extractFunctions(code) {
  const functions = [];
  const lines = code.split('\n');

  let currentFunction = null;
  let braceCount = 0;
  let inFunction = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 関数定義の検出（簡易版）
    const functionMatch = line.match(/(?:function\s+(\w+)|(\w+)\s*[:=]\s*(?:function|async\s+function|\([^)]*\)\s*=>))/);
    if (functionMatch && !inFunction) {
      currentFunction = {
        name: functionMatch[1] || functionMatch[2],
        startLine: i + 1,
        code: ''
      };
      inFunction = true;
      braceCount = 0;
    }

    if (inFunction) {
      currentFunction.code += line + '\n';

      // 波括弧カウント
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;

      // 関数終了の検出
      if (braceCount <= 0 && currentFunction.code.includes('{')) {
        currentFunction.endLine = i + 1;
        currentFunction.code = currentFunction.code.trim();

        if (currentFunction.code.length > 50) { // 最小コード長
          functions.push(currentFunction);
        }

        inFunction = false;
        currentFunction = null;
      }
    }
  }

  return functions;
}

/**
 * メイン分析関数
 */
async function analyzeSimilarity() {
  console.log('🔍 コード類似度分析を開始します...\n');

  // 分析対象ファイルの収集
  const allFiles = [];
  for (const dir of TARGET_DIRS) {
    if (fs.existsSync(dir)) {
      allFiles.push(...getJSFiles(dir));
    }
  }

  console.log(`📂 分析対象ファイル数: ${allFiles.length}`);
  console.log(`🎯 類似度閾値: ${SIMILARITY_THRESHOLD * 100}%\n`);

  const similarityResults = [];
  const functionResults = [];

  // ファイルレベルの類似度分析
  for (let i = 0; i < allFiles.length; i++) {
    const file1 = allFiles[i];
    const code1 = extractCode(file1);

    if (code1.length < 50) {
      continue;
    }

    for (let j = i + 1; j < allFiles.length; j++) {
      const file2 = allFiles[j];
      const code2 = extractCode(file2);

      if (code2.length < 50) {
        continue;
      }

      const similarity = stringSimilarity.stringSimilarity(code1, code2);

      if (similarity >= SIMILARITY_THRESHOLD) {
        similarityResults.push({
          file1: path.relative(process.cwd(), file1),
          file2: path.relative(process.cwd(), file2),
          similarity: Math.round(similarity * 100),
          size1: code1.length,
          size2: code2.length
        });
      }
    }
  }

  // 関数レベルの類似度分析
  console.log('🔧 関数レベルの分析を実行中...');
  const allFunctions = [];

  for (const file of allFiles) {
    const code = extractCode(file);
    const functions = extractFunctions(code);

    for (const func of functions) {
      allFunctions.push({
        ...func,
        file: path.relative(process.cwd(), file)
      });
    }
  }

  // 関数間類似度比較
  for (let i = 0; i < allFunctions.length; i++) {
    const func1 = allFunctions[i];

    for (let j = i + 1; j < allFunctions.length; j++) {
      const func2 = allFunctions[j];

      // 同じファイル内の関数は除外
      if (func1.file === func2.file) {
        continue;
      }

      const similarity = stringSimilarity.stringSimilarity(func1.code, func2.code);

      if (similarity >= SIMILARITY_THRESHOLD) {
        functionResults.push({
          function1: `${func1.name} (${func1.file}:${func1.startLine})`,
          function2: `${func2.name} (${func2.file}:${func2.startLine})`,
          similarity: Math.round(similarity * 100),
          codeLength1: func1.code.length,
          codeLength2: func2.code.length
        });
      }
    }
  }

  // 結果の出力
  console.log('\n📊 === 分析結果 ===\n');

  if (similarityResults.length > 0) {
    console.log('🔴 高類似度ファイル:');
    similarityResults
      .sort((a, b) => b.similarity - a.similarity)
      .forEach(result => {
        console.log(`  ${result.similarity}% - ${result.file1} ↔ ${result.file2}`);
        console.log(`    サイズ: ${result.size1} vs ${result.size2} 文字\n`);
      });
  } else {
    console.log('✅ ファイルレベルでの高類似度コードは見つかりませんでした。\n');
  }

  if (functionResults.length > 0) {
    console.log('🟡 高類似度関数:');
    functionResults
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10) // 上位10件のみ表示
      .forEach(result => {
        console.log(`  ${result.similarity}% - ${result.function1} ↔ ${result.function2}`);
        console.log(`    コード長: ${result.codeLength1} vs ${result.codeLength2} 文字\n`);
      });

    if (functionResults.length > 10) {
      console.log(`  ... 他 ${functionResults.length - 10} 件の類似関数があります\n`);
    }
  } else {
    console.log('✅ 関数レベルでの高類似度コードは見つかりませんでした。\n');
  }

  // リファクタリング提案
  if (similarityResults.length > 0 || functionResults.length > 0) {
    console.log('💡 === リファクタリング提案 ===\n');

    if (similarityResults.length > 0) {
      console.log('📁 ファイルレベル:');
      console.log('  - 類似ファイルの共通部分を抽出してユーティリティモジュール化');
      console.log('  - 設定やテンプレート部分の統一\n');
    }

    if (functionResults.length > 0) {
      console.log('⚙️ 関数レベル:');
      console.log('  - 類似関数の共通ロジックを抽出して共通関数化');
      console.log('  - パラメータ化による汎用化');
      console.log('  - 継承やコンポジションパターンの適用\n');
    }
  }

  console.log('🎉 分析完了！');

  return {
    fileResults: similarityResults,
    functionResults: functionResults,
    totalFiles: allFiles.length,
    totalFunctions: allFunctions.length
  };
}

// スクリプトとして直接実行された場合
if (require.main === module) {
  analyzeSimilarity().catch(console.error);
}

module.exports = { analyzeSimilarity };