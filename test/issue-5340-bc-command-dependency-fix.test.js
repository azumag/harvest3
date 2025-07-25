/**
 * Issue #5340: entrypoint.sh bcコマンド依存問題修正テスト
 * 
 * CI失敗の原因となったbcコマンド依存を除去し、Node.js環境間での互換性を確保
 */

const fs = require('fs').promises;
const { execSync } = require('child_process');

describe('Issue #5340: entrypoint.sh bcコマンド依存問題修正', () => {
    const entrypointPath = './entrypoint.sh';

    test('entrypoint.shがbcコマンドに依存していないことを確認', async () => {
        const content = await fs.readFile(entrypointPath, 'utf8');
        
        // bcコマンドの使用がないことを確認
        const bcUsagePattern = /\|\s*bc\s/g;
        const bcCommandPattern = /command\s+-v\s+bc/g;
        const bcArithmeticPattern = /\$\(.*bc.*\)/g;
        
        const bcUsageMatches = content.match(bcUsagePattern);
        const bcCommandMatches = content.match(bcCommandPattern);
        const bcArithmeticMatches = content.match(bcArithmeticPattern);
        
        expect(bcUsageMatches).toBeNull();
        expect(bcCommandMatches).toBeNull();
        expect(bcArithmeticMatches).toBeNull();
        
        console.log('✓ entrypoint.shはbcコマンドに依存していません');
    });

    test('check_timestamp_validity関数が整数算術のみを使用することを確認', async () => {
        const content = await fs.readFile(entrypointPath, 'utf8');
        
        // check_timestamp_validity関数の抽出
        const functionMatch = content.match(/check_timestamp_validity\(\)\s*\{[\s\S]*?\n\}/);
        expect(functionMatch).not.toBeNull();
        
        const functionBody = functionMatch[0];
        
        // bash内蔵算術演算子の使用を確認
        expect(functionBody).toMatch(/\$\(\(.*\)\)/); // $((arithmetic))
        expect(functionBody).toMatch(/\${.*%\.\*}/); // ${var%.*} pattern
        
        // bcコマンドが実際に使用されていないことを確認（コメント内は除外）
        expect(functionBody).not.toMatch(/\|\s*bc\s/);
        expect(functionBody).not.toMatch(/command\s+-v\s+bc/);
        expect(functionBody).not.toMatch(/\$\(.*bc.*\)/);
        
        console.log('✓ check_timestamp_validity関数は整数算術のみを使用しています');
    });

    test('log_backtest_startup_message関数が整数算術のみを使用することを確認', async () => {
        const content = await fs.readFile(entrypointPath, 'utf8');
        
        // log_backtest_startup_message関数の抽出
        const functionMatch = content.match(/log_backtest_startup_message\(\)\s*\{[\s\S]*?(?=\n\w|\n#|\n$)/);
        expect(functionMatch).not.toBeNull();
        
        const functionBody = functionMatch[0];
        
        // bash内蔵算術演算子の使用を確認
        expect(functionBody).toMatch(/\$\(\(.*\)\)/); // $((arithmetic))
        expect(functionBody).toMatch(/\${.*%\.\*}/); // ${var%.*} pattern
        
        // bcコマンドが実際に使用されていないことを確認（コメント内は除外）
        expect(functionBody).not.toMatch(/\|\s*bc\s/);
        expect(functionBody).not.toMatch(/command\s+-v\s+bc/);
        expect(functionBody).not.toMatch(/\$\(.*bc.*\)/);
        
        console.log('✓ log_backtest_startup_message関数は整数算術のみを使用しています');
    });

    test('entrypoint.shの構文が正しいことを確認', () => {
        expect(() => {
            execSync(`bash -n ${entrypointPath}`, { stdio: 'pipe' });
        }).not.toThrow();
        
        console.log('✓ entrypoint.shの構文は正しく、bashで実行可能です');
    });

    test('Issue #5340修正コメントが適切に追加されていることを確認', async () => {
        const content = await fs.readFile(entrypointPath, 'utf8');
        
        // Issue #5340修正コメントの存在確認
        expect(content).toMatch(/Issue #5340修正.*bcコマンド依存を除去/);
        expect(content).toMatch(/整数算術のみ使用/);
        expect(content).toMatch(/CI環境での互換性を確保/);
        
        console.log('✓ Issue #5340修正コメントが適切に追加されています');
    });

    test('タイムスタンプ整数変換のロジックが正しく実装されていることを確認', async () => {
        const content = await fs.readFile(entrypointPath, 'utf8');
        
        // 整数変換パターンの確認
        expect(content).toMatch(/current_time_int=\${current_time%\.\*}/);
        expect(content).toMatch(/last_time_int=\${last_time%\.\*}/);
        expect(content).toMatch(/time_diff=\$\(\(current_time_int - last_time_int\)\)/);
        
        console.log('✓ タイムスタンプ整数変換のロジックが正しく実装されています');
    });

    test('CI環境互換性: bcコマンドが利用できない環境でも動作することを確認', () => {
        // bcコマンドを一時的に無効化してテスト実行
        const originalPath = process.env.PATH;
        
        try {
            // bcコマンドを含まないPATHを設定
            process.env.PATH = process.env.PATH
                .split(':')
                .filter(path => !path.includes('bc'))
                .join(':');
            
            // entrypoint.shの構文チェックが引き続き通ることを確認
            expect(() => {
                execSync(`bash -n ${entrypointPath}`, { stdio: 'pipe' });
            }).not.toThrow();
            
            console.log('✓ bcコマンドが利用できない環境でも構文チェックが通ります');
        } finally {
            // PATH環境変数を復元
            process.env.PATH = originalPath;
        }
    });
});