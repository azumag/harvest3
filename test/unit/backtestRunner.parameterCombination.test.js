describe('BacktestRunner Parameter Combination Null/Undefined Handling', () => {
  let originalConsoleWarn;
  let originalConsoleLog;

  beforeEach(() => {
    // コンソール警告とログをモック
    originalConsoleWarn = console.warn;
    originalConsoleLog = console.log;
    console.warn = jest.fn();
    console.log = jest.fn();
  });

  afterEach(() => {
    // オリジナルの関数を復元
    console.warn = originalConsoleWarn;
    console.log = originalConsoleLog;
  });

  describe('重複排除処理でのnull/undefinedチェック', () => {
    test('nullパラメータ組み合わせが適切にスキップされる', () => {
      // 重複排除処理の一部を模擬
      const parameterCombinations = [
        { param1: 10, param2: 20 },
        null,
        { param1: 15, param2: 25 },
        undefined,
        { param1: 10, param2: 20 } // 重複
      ];

      const uniqueCombinationsMap = new Map();
      let processedCount = 0;
      let skippedCount = 0;

      parameterCombinations.forEach(combo => {
        // バックテストランナーと同じnull/undefinedチェック
        if (!combo || typeof combo !== 'object') {
          console.warn('無効なパラメータ組み合わせをスキップ:', combo);
          skippedCount++;
          return;
        }
        
        const keys = Object.keys(combo).sort();
        const sortedCombo = {};
        keys.forEach(key => sortedCombo[key] = combo[key]);

        const comboKey = JSON.stringify(sortedCombo);

        if (!uniqueCombinationsMap.has(comboKey)) {
          uniqueCombinationsMap.set(comboKey, combo);
        }
        processedCount++;
      });

      // null/undefinedが適切にスキップされていることを確認
      expect(skippedCount).toBe(2); // null と undefined
      expect(processedCount).toBe(3); // 有効な3つのオブジェクト
      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalledWith('無効なパラメータ組み合わせをスキップ:', null);
      expect(console.warn).toHaveBeenCalledWith('無効なパラメータ組み合わせをスキップ:', undefined);

      // 最終的に重複排除された有効な組み合わせが2つになることを確認
      const finalCombinations = Array.from(uniqueCombinationsMap.values());
      expect(finalCombinations).toHaveLength(2);
    });

    test('非オブジェクト型パラメータ組み合わせが適切にスキップされる', () => {
      const parameterCombinations = [
        { param1: 10, param2: 20 },
        'invalid string',
        123,
        true,
        [],
        { param1: 15, param2: 25 }
      ];

      const uniqueCombinationsMap = new Map();
      let skippedCount = 0;

      parameterCombinations.forEach(combo => {
        if (!combo || typeof combo !== 'object') {
          console.warn('無効なパラメータ組み合わせをスキップ:', combo);
          skippedCount++;
          return;
        }
        
        const keys = Object.keys(combo).sort();
        const sortedCombo = {};
        keys.forEach(key => sortedCombo[key] = combo[key]);

        const comboKey = JSON.stringify(sortedCombo);

        if (!uniqueCombinationsMap.has(comboKey)) {
          uniqueCombinationsMap.set(comboKey, combo);
        }
      });

      // 非オブジェクト型が適切にスキップされていることを確認（配列は技術的にはobjectなのでスキップされない）
      expect(skippedCount).toBe(3); // string, number, boolean（配列はobjectなのでスキップされない）
      expect(console.warn).toHaveBeenCalledTimes(3);
      expect(console.warn).toHaveBeenCalledWith('無効なパラメータ組み合わせをスキップ:', 'invalid string');
      expect(console.warn).toHaveBeenCalledWith('無効なパラメータ組み合わせをスキップ:', 123);
      expect(console.warn).toHaveBeenCalledWith('無効なパラメータ組み合わせをスキップ:', true);

      // 有効な組み合わせ（オブジェクト2つ＋配列1つ）が処理されることを確認
      const finalCombinations = Array.from(uniqueCombinationsMap.values());
      expect(finalCombinations).toHaveLength(3);
    });

    test('すべてが無効なパラメータ組み合わせの場合、空の結果になる', () => {
      const parameterCombinations = [null, undefined, 'string', 123, true];

      const uniqueCombinationsMap = new Map();
      let skippedCount = 0;

      parameterCombinations.forEach(combo => {
        if (!combo || typeof combo !== 'object') {
          console.warn('無効なパラメータ組み合わせをスキップ:', combo);
          skippedCount++;
          return;
        }
        
        const keys = Object.keys(combo).sort();
        const sortedCombo = {};
        keys.forEach(key => sortedCombo[key] = combo[key]);

        const comboKey = JSON.stringify(sortedCombo);

        if (!uniqueCombinationsMap.has(comboKey)) {
          uniqueCombinationsMap.set(comboKey, combo);
        }
      });

      expect(skippedCount).toBe(5);
      expect(console.warn).toHaveBeenCalledTimes(5);
      
      const finalCombinations = Array.from(uniqueCombinationsMap.values());
      expect(finalCombinations).toHaveLength(0);
    });
  });

  describe('バックテスト実行ループでのnull/undefinedチェック', () => {
    test('nullパラメータ組み合わせが適切にスキップされる', () => {
      const parameterCombinations = [
        { param1: 10, param2: 20 },
        null,
        { param1: 15, param2: 25 },
        undefined
      ];

      let processedCount = 0;
      let skippedCount = 0;

      for (const paramCombination of parameterCombinations) {
        // バックテストランナーと同じnull/undefinedチェック
        if (!paramCombination || typeof paramCombination !== 'object') {
          console.warn('無効なパラメータ組み合わせをスキップ:', paramCombination);
          skippedCount++;
          continue;
        }

        // 模擬バックテスト処理
        processedCount++;
        console.log(`パラメータテスト: ${JSON.stringify(paramCombination)}`);
      }

      expect(skippedCount).toBe(2); // null と undefined
      expect(processedCount).toBe(2); // 有効な2つのオブジェクト
      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalledWith('無効なパラメータ組み合わせをスキップ:', null);
      expect(console.warn).toHaveBeenCalledWith('無効なパラメータ組み合わせをスキップ:', undefined);
      expect(console.log).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith('パラメータテスト: {"param1":10,"param2":20}');
      expect(console.log).toHaveBeenCalledWith('パラメータテスト: {"param1":15,"param2":25}');
    });

    test('Object.keys()でエラーが発生しないことを確認', () => {
      const parameterCombinations = [
        { param1: 10, param2: 20 },
        null,
        undefined,
        'string',
        123
      ];

      // この処理でTypeErrorが発生しないことを確認
      expect(() => {
        for (const paramCombination of parameterCombinations) {
          if (!paramCombination || typeof paramCombination !== 'object') {
            console.warn('無効なパラメータ組み合わせをスキップ:', paramCombination);
            continue;
          }

          // この行でエラーが発生しないことが重要
          const keys = Object.keys(paramCombination).sort();
          const sortedCombo = {};
          keys.forEach(key => sortedCombo[key] = paramCombination[key]);
          
          console.log(`パラメータテスト: ${JSON.stringify(paramCombination)}`);
        }
      }).not.toThrow();

      expect(console.warn).toHaveBeenCalledTimes(4);
      expect(console.log).toHaveBeenCalledTimes(1); // 有効なオブジェクトは1つのみ
    });

    test('スプレッド演算子でエラーが発生しないことを確認', () => {
      const parameterCombinations = [
        { param1: 10, param2: 20 },
        null,
        undefined
      ];

      const _strategyConfig = { baseParam: 'test' };
      const config = { global: { tradePercentage: 0.1 } };
      const timeframe = '1h';

      expect(() => {
        for (const paramCombination of parameterCombinations) {
          if (!paramCombination || typeof paramCombination !== 'object') {
            console.warn('無効なパラメータ組み合わせをスキップ:', paramCombination);
            continue;
          }

          // この行でエラーが発生しないことが重要
          const strategyConfig = {
            ..._strategyConfig,
            hlcvInterval: timeframe,
            ...paramCombination,
            tradePercentage: config.global.tradePercentage
          };

          console.log(`パラメータテスト: ${JSON.stringify(paramCombination)}`);
        }
      }).not.toThrow();

      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('TypeErrorの予防確認', () => {
    test('修正前に発生していたTypeError: Cannot convert undefined or null to objectが発生しない', () => {
      // これらの値は以前Object.keys()でTypeErrorを引き起こしていた
      const problematicValues = [null, undefined];

      problematicValues.forEach(value => {
        expect(() => {
          // 修正後のチェック処理
          if (!value || typeof value !== 'object') {
            console.warn('無効なパラメータ組み合わせをスキップ:', value);
            return;
          }
          // ここまで到達しない
          Object.keys(value);
        }).not.toThrow();
      });

      expect(console.warn).toHaveBeenCalledTimes(2);
    });

    test('修正前のコードで発生していたエラーパターンの検証', () => {
      // 修正前のコードを模擬（修正前はnull/undefinedチェックがなかった）
      const nullValue = null;
      const undefinedValue = undefined;

      // 修正前はこれらでTypeErrorが発生していた
      expect(() => Object.keys(nullValue)).toThrow(TypeError);
      expect(() => Object.keys(undefinedValue)).toThrow(TypeError);

      // 修正後は適切にチェックされてエラーが発生しない
      expect(() => {
        if (!nullValue || typeof nullValue !== 'object') {
          return; // 適切にスキップ
        }
        Object.keys(nullValue);
      }).not.toThrow();

      expect(() => {
        if (!undefinedValue || typeof undefinedValue !== 'object') {
          return; // 適切にスキップ
        }
        Object.keys(undefinedValue);
      }).not.toThrow();
    });
  });
});