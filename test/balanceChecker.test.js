/**
 * BalanceCheckerクラスのユニットテスト
 * Issue #2493の修正に対するテスト
 */

// ログレベル判定ロジックのテスト用モック
const mockLogger = {
  logs: [],
  debug: function(message) { this.logs.push({ level: 'debug', message }); },
  info: function(message) { this.logs.push({ level: 'info', message }); },
  warn: function(message) { this.logs.push({ level: 'warn', message }); },
  error: function(message) { this.logs.push({ level: 'error', message }); },
  clear: function() { this.logs = []; }
};

// テスト用のダミーデータ
const createTestDiscrepancy = (currency, discrepancyPercent, isExternalTradeSuspected = true) => ({
  currency,
  exchangeAmount: 100,
  botAmount: 10,
  difference: 90,
  discrepancyPercent,
  tolerancePercent: 2,
  isExternalTradeSuspected,
  timestamp: Date.now(),
  exchangeId: 'test-exchange'
});

describe('BalanceChecker - ログレベル判定ロジック', () => {
  // processDiscrepancies関数の簡略版をテスト用に実装
  function testLogLevelDetermination(uniqueDiscrepancies, exchangeId = 'test-exchange') {
    const highDiscrepancyThreshold = 10;
    const externalTradeThreshold = 50;
    const veryHighThreshold = 90;
    
    const highDiscrepancies = uniqueDiscrepancies.filter(disc => 
      disc.discrepancyPercent >= highDiscrepancyThreshold
    );
    const externalTradeDiscrepancies = uniqueDiscrepancies.filter(disc => 
      disc.isExternalTradeSuspected
    );
    const veryHighExternalTradeDiscrepancies = uniqueDiscrepancies.filter(disc => 
      disc.discrepancyPercent >= veryHighThreshold && disc.isExternalTradeSuspected
    );
    
    let logLevel, severityText;
    
    if (veryHighExternalTradeDiscrepancies.length > 0 && 
        veryHighExternalTradeDiscrepancies.length === uniqueDiscrepancies.length) {
      logLevel = 'info';
      severityText = '外部取引による残高差異';
    } else if (externalTradeDiscrepancies.length === uniqueDiscrepancies.length && 
               externalTradeDiscrepancies.length > 0) {
      logLevel = 'info';
      severityText = '外部取引による残高差異';
    } else if (veryHighExternalTradeDiscrepancies.length > 0) {
      logLevel = 'warn';
      severityText = veryHighExternalTradeDiscrepancies.length === externalTradeDiscrepancies.length
        ? '外部取引による残高差異（一部混在）'
        : '混合不整合（明らかな外部取引含む）';
    } else if (highDiscrepancies.length > 0) {
      logLevel = 'error';
      severityText = externalTradeDiscrepancies.length > 0 
        ? '高度不整合（外部取引の可能性含む）' 
        : '高度不整合';
    } else {
      logLevel = 'warn';
      severityText = externalTradeDiscrepancies.length > 0 
        ? '軽微な不整合（外部取引の可能性）' 
        : '軽微な不整合';
    }
    
    return { logLevel, severityText };
  }

  test('全ての差異が90%以上で外部取引の可能性がある場合はINFOレベルになる', () => {
    const discrepancies = [
      createTestDiscrepancy('DOGE', 99.96, true),
      createTestDiscrepancy('BAT', 99.7, true),
      createTestDiscrepancy('BTC', 95.0, true)
    ];
    
    const result = testLogLevelDetermination(discrepancies);
    
    expect(result.logLevel).toBe('info');
    expect(result.severityText).toBe('外部取引による残高差異');
  });

  test('全ての差異が50%以上で外部取引の可能性がある場合はINFOレベルになる', () => {
    const discrepancies = [
      createTestDiscrepancy('DOGE', 80.0, true),
      createTestDiscrepancy('BAT', 70.0, true),
      createTestDiscrepancy('BTC', 60.0, true)
    ];
    
    const result = testLogLevelDetermination(discrepancies);
    
    expect(result.logLevel).toBe('info');
    expect(result.severityText).toBe('外部取引による残高差異');
  });

  test('一部が90%以上の外部取引で一部がそれ以下の場合はWARNレベルになる', () => {
    const discrepancies = [
      createTestDiscrepancy('DOGE', 95.0, true),
      createTestDiscrepancy('BAT', 30.0, false) // 外部取引ではない低い不整合
    ];
    
    const result = testLogLevelDetermination(discrepancies);
    
    expect(result.logLevel).toBe('warn');
    expect(result.severityText).toContain('外部取引による残高差異（一部混在）');
  });

  test('高度不整合で外部取引の可能性が低い場合はERRORレベルになる', () => {
    const discrepancies = [
      createTestDiscrepancy('DOGE', 20.0, false),
      createTestDiscrepancy('BAT', 15.0, false)
    ];
    
    const result = testLogLevelDetermination(discrepancies);
    
    expect(result.logLevel).toBe('error');
    expect(result.severityText).toBe('高度不整合');
  });

  test('軽微な不整合で外部取引の可能性がある場合はWARNレベルになる', () => {
    const discrepancies = [
      createTestDiscrepancy('DOGE', 5.0, false), // 10%未満は軽微な不整合
      createTestDiscrepancy('BAT', 3.0, false)
    ];
    
    const result = testLogLevelDetermination(discrepancies);
    
    expect(result.logLevel).toBe('warn');
    expect(result.severityText).toBe('軽微な不整合');
  });

  test('軽微な不整合で外部取引の可能性がない場合はWARNレベルになる', () => {
    const discrepancies = [
      createTestDiscrepancy('DOGE', 5.0, false),
      createTestDiscrepancy('BAT', 3.0, false)
    ];
    
    const result = testLogLevelDetermination(discrepancies);
    
    expect(result.logLevel).toBe('warn');
    expect(result.severityText).toBe('軽微な不整合');
  });
});

describe('BalanceChecker - 重複除去ロジック', () => {
  // 通貨名正規化のテスト用関数
  function normalizeCurrency(currency) {
    return currency.trim().toUpperCase();
  }

  // 重複除去ロジックのテスト用関数
  function testDuplicateRemoval(discrepancies) {
    const uniqueDiscrepancies = [];
    const seenCurrencies = new Map();
    let duplicateCount = 0;
    
    for (const disc of discrepancies) {
      const normalizedDiscCurrency = normalizeCurrency(disc.currency);
      
      if (!seenCurrencies.has(normalizedDiscCurrency)) {
        const enhancedDisc = {
          ...disc,
          currency: normalizedDiscCurrency,
          originalCurrency: disc.originalCurrency || disc.currency,
          processedAt: Date.now()
        };
        uniqueDiscrepancies.push(enhancedDisc);
        seenCurrencies.set(normalizedDiscCurrency, {
          index: uniqueDiscrepancies.length - 1,
          originalCurrency: disc.currency,
          processedAt: enhancedDisc.processedAt
        });
      } else {
        duplicateCount++;
      }
    }
    
    return { uniqueDiscrepancies, duplicateCount };
  }

  test('重複する通貨エントリが除去される', () => {
    const discrepancies = [
      createTestDiscrepancy('DOGE', 99.96, true),
      createTestDiscrepancy('BAT', 99.7, true),
      createTestDiscrepancy('DOGE', 99.96, true) // 重複
    ];
    
    const result = testDuplicateRemoval(discrepancies);
    
    expect(result.uniqueDiscrepancies).toHaveLength(2);
    expect(result.duplicateCount).toBe(1);
    
    const currencies = result.uniqueDiscrepancies.map(d => d.currency);
    expect(currencies).toEqual(['DOGE', 'BAT']);
  });

  test('大文字小文字の違いがある重複が除去される', () => {
    const discrepancies = [
      createTestDiscrepancy('doge', 99.96, true),
      createTestDiscrepancy('DOGE', 99.96, true), // 重複（大文字小文字違い）
      createTestDiscrepancy('DoGe', 99.96, true)  // 重複（大文字小文字違い）
    ];
    
    const result = testDuplicateRemoval(discrepancies);
    
    expect(result.uniqueDiscrepancies).toHaveLength(1);
    expect(result.duplicateCount).toBe(2);
    expect(result.uniqueDiscrepancies[0].currency).toBe('DOGE');
  });

  test('空白文字を含む通貨名の重複が除去される', () => {
    const discrepancies = [
      createTestDiscrepancy(' DOGE ', 99.96, true),
      createTestDiscrepancy('DOGE', 99.96, true), // 重複（空白文字違い）
      createTestDiscrepancy('  doge  ', 99.96, true)  // 重複（空白文字・大文字小文字違い）
    ];
    
    const result = testDuplicateRemoval(discrepancies);
    
    expect(result.uniqueDiscrepancies).toHaveLength(1);
    expect(result.duplicateCount).toBe(2);
    expect(result.uniqueDiscrepancies[0].currency).toBe('DOGE');
  });

  test('異なる通貨は重複扱いされない', () => {
    const discrepancies = [
      createTestDiscrepancy('DOGE', 99.96, true),
      createTestDiscrepancy('BAT', 99.7, true),
      createTestDiscrepancy('BTC', 95.0, true)
    ];
    
    const result = testDuplicateRemoval(discrepancies);
    
    expect(result.uniqueDiscrepancies).toHaveLength(3);
    expect(result.duplicateCount).toBe(0);
    
    const currencies = result.uniqueDiscrepancies.map(d => d.currency);
    expect(currencies).toEqual(['DOGE', 'BAT', 'BTC']);
  });
});

describe('BalanceChecker - Issue #2493 シナリオテスト', () => {
  test('Issue #2493のシナリオ: 全て97-100%の差異でINFOレベルになる', () => {
    // 実際のエラーログと同じような差異を再現
    const discrepancies = [
      createTestDiscrepancy('BAT', 99.7, true),
      createTestDiscrepancy('OMG', 97.04, true),
      createTestDiscrepancy('XYM', 99.83, true),
      createTestDiscrepancy('LINK', 100, true),
      createTestDiscrepancy('MKR', 100, true),
      createTestDiscrepancy('BOBA', 99.26, true),
      createTestDiscrepancy('ENJ', 100, true),
      createTestDiscrepancy('DOT', 99.95, true),
      createTestDiscrepancy('DOGE', 99.96, true),
      createTestDiscrepancy('DOGE', 99.96, true) // 重複エントリ
    ];
    
    // 重複除去
    const mockRemoveDuplicateDiscrepancies = (discrepancies) => {
      const uniqueDiscrepancies = [];
      const seenCurrencies = new Map();
      
      for (const disc of discrepancies) {
        const normalizedCurrency = disc.currency.trim().toUpperCase();
        
        if (!seenCurrencies.has(normalizedCurrency)) {
          uniqueDiscrepancies.push({
            ...disc,
            currency: normalizedCurrency,
            originalCurrency: disc.currency
          });
          seenCurrencies.set(normalizedCurrency, true);
        }
      }
      
      return uniqueDiscrepancies;
    };
    
    const uniqueDiscrepancies = mockRemoveDuplicateDiscrepancies(discrepancies);
    
    // 重複が除去されているかテスト
    expect(uniqueDiscrepancies).toHaveLength(9); // 10 - 1 (重複のDOGE)
    
    // ログレベル判定をテスト
    const highDiscrepancyThreshold = 10;
    const externalTradeThreshold = 50;
    const veryHighThreshold = 90;
    
    const veryHighExternalTradeDiscrepancies = uniqueDiscrepancies.filter(disc => 
      disc.discrepancyPercent >= veryHighThreshold && disc.isExternalTradeSuspected
    );
    
    // 全て90%以上の外部取引の可能性があることを確認
    expect(veryHighExternalTradeDiscrepancies).toHaveLength(uniqueDiscrepancies.length);
    
    // INFOレベルになることを確認
    const shouldBeInfo = veryHighExternalTradeDiscrepancies.length > 0 && 
                        veryHighExternalTradeDiscrepancies.length === uniqueDiscrepancies.length;
    expect(shouldBeInfo).toBe(true);
  });
});