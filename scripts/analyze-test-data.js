#!/usr/bin/env node

/**
 * テストデータの分析
 * 収集されたテストデータを使用して分析システムの動作を確認
 */

const RealDataAnalyzer = require('./analyze-real-data');

async function analyzeTestData() {
    console.log('🔍 テストデータ分析開始...\n');
    
    // テストデータファイルを指定
    const testDataFile = '/Users/azumag/work/harvest3/data/test-performance-data.json';
    const analyzer = new RealDataAnalyzer(testDataFile);
    
    try {
        // 分析実行
        const success = await analyzer.runFullAnalysis();
        
        if (success) {
            console.log('\n✅ テストデータ分析成功');
            console.log('   理論値と実測値の比較が完了しました');
            
            // 分析結果ファイルの確認
            console.log('\n📄 生成された分析結果:');
            console.log('   - docs/real-data-analysis.json');
            console.log('   - docs/threshold-recommendations.json');
            
        } else {
            console.log('\n❌ テストデータ分析失敗');
        }
        
    } catch (error) {
        console.error('❌ 分析エラー:', error.message);
    }
}

// 実行
analyzeTestData();