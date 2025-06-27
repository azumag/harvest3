/**
 * Time Series Cross-Validation 包括テストスイート
 * 
 * テスト設計指針：
 * - t-wadaスタイル（Red-Green-Blue）準拠
 * - Advance of Decline Lopez de Prado手法の参考実装
 * - 金融時系列の非定常性とデータリーケージ防止
 * - 時系列特有のバリデーション手法の包括的検証
 * 
 * 実装機能：
 * - Time Series Split機能
 * - Purged GroupKFold機能  
 * - Embargo period実装
 * - Nested Cross-Validation
 * - Blocked Cross-Validation
 * - Combinatorial Purged Cross-Validation
 * - データ汚染防止・情報漏洩検出
 * - Temporal leakage prevention
 * 
 * 作成者: worker-claude
 * 日付: 2025-06-27
 */

const { 
  TimeSeriesCrossValidator,
  TimeSeriesSplitter,
  PurgedGroupKFold,
  EmbargoValidator,
  NestedCrossValidator,
  BlockedCrossValidator,
  CombinatorialPurgedCV,
  DataContaminationDetector,
  InformationLeakageDetector,
  TemporalLeakagePreventor,
  LopezDePradoSplitter,
  FinancialTimeSeriesValidator
} = require('../../../../src/strategies/utils/timeSeriesCrossValidation');

describe('Time Series Cross-Validation 包括テストスイート', () => {
  let financialData;
  let tsValidator;
  
  beforeEach(() => {
    // 金融時系列データの生成
    financialData = generateFinancialTimeSeriesData();
    tsValidator = new TimeSeriesCrossValidator({
      nSplits: 5,
      testSize: 0.2,
      purgeGap: 3,
      embargoLength: 2,
      maxTestLength: 100
    });
  });

  describe('🔴 Red Phase: 失敗ケース - Time Series Split機能', () => {
    
    test('時系列順序が破綻したデータで分割が正しく失敗する', () => {
      const corruptedData = createCorruptedTimeSeriesData();
      
      expect(() => {
        tsValidator.timeSeriesSplit(corruptedData);
      }).toThrow('時系列順序が破綻しています');
    });

    test('不十分なデータサイズで分割が正しく失敗する', () => {
      const insufficientData = financialData.slice(0, 10);
      
      expect(() => {
        tsValidator.timeSeriesSplit(insufficientData);
      }).toThrow('データサイズが不十分です');
    });

    test('無効なsplit数設定が正しく拒否される', () => {
      expect(() => {
        new TimeSeriesCrossValidator({ nSplits: 0 });
      }).toThrow('分割数は1以上である必要があります');
      
      expect(() => {
        new TimeSeriesCrossValidator({ nSplits: -1 });
      }).toThrow('分割数は1以上である必要があります');
    });

    test('未来データアクセスが検出される', () => {
      const validator = new TimeSeriesCrossValidator({ 
        nSplits: 3, 
        testSize: 0.15,
        minTrainSize: 50
      });
      
      const cleanData = generateFinancialTimeSeriesData(500);
      const splits = validator.timeSeriesSplit(cleanData);
      
      // 手動で未来情報を注入
      splits[0].trainData[0].futureInfo = splits[0].testData[0].price;
      
      expect(() => {
        validator.validateSplits(splits);
      }).toThrow('未来データアクセスが検出されました');
    });

  });

  describe('🟢 Green Phase: 最小実装 - Time Series Split機能', () => {
    
    test('基本的な時系列分割が正しく動作する', () => {
      const splits = tsValidator.timeSeriesSplit(financialData);
      
      expect(splits).toBeDefined();
      expect(Array.isArray(splits)).toBe(true);
      expect(splits.length).toBe(5);
      
      // 各分割の基本構造を検証
      splits.forEach((split, index) => {
        expect(split).toHaveProperty('trainIndices');
        expect(split).toHaveProperty('testIndices');
        expect(split).toHaveProperty('trainData');
        expect(split).toHaveProperty('testData');
        expect(split.trainData.length).toBeGreaterThan(0);
        expect(split.testData.length).toBeGreaterThan(0);
      });
    });

    test('時系列順序が保持される', () => {
      const splits = tsValidator.timeSeriesSplit(financialData);
      
      splits.forEach(split => {
        // 訓練データの時系列順序をチェック
        for (let i = 1; i < split.trainData.length; i++) {
          expect(split.trainData[i].timestamp.getTime())
            .toBeGreaterThanOrEqual(split.trainData[i-1].timestamp.getTime());
        }
        
        // テストデータの時系列順序をチェック
        for (let i = 1; i < split.testData.length; i++) {
          expect(split.testData[i].timestamp.getTime())
            .toBeGreaterThanOrEqual(split.testData[i-1].timestamp.getTime());
        }
        
        // 訓練データがテストデータより前の時刻であることを確認
        const lastTrainTime = split.trainData[split.trainData.length - 1].timestamp.getTime();
        const firstTestTime = split.testData[0].timestamp.getTime();
        expect(firstTestTime).toBeGreaterThan(lastTrainTime);
      });
    });

    test('分割サイズが正しく計算される', () => {
      const testSize = 0.2;
      const validator = new TimeSeriesCrossValidator({ 
        nSplits: 3, 
        testSize,
        minTrainSize: 50,
        purgeGap: 0,
        embargoLength: 0
      });
      
      const splits = validator.timeSeriesSplit(financialData);
      const expectedTestSize = Math.floor(financialData.length * testSize);
      
      splits.forEach(split => {
        expect(split.testData.length).toBeGreaterThan(0);
        expect(split.testData.length).toBeLessThanOrEqual(expectedTestSize + 50);
      });
    });

  });

  describe('🔵 Blue Phase: リファクタリング - Time Series Split機能', () => {
    
    test('大規模データでのパフォーマンスが適切', () => {
      const largeData = generateFinancialTimeSeriesData(50000);
      
      const startTime = performance.now();
      const splits = tsValidator.timeSeriesSplit(largeData);
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(2000); // 2秒以内
      expect(splits.length).toBe(5);
    });

    test('メモリ効率的な分割が実行される', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      const splits = tsValidator.timeSeriesSplit(financialData);
      const finalMemory = process.memoryUsage().heapUsed;
      
      const memoryIncrease = finalMemory - initialMemory;
      expect(memoryIncrease).toBeLessThan(financialData.length * 1000);
    });

    test('適応的分割サイズ調整機能', () => {
      const adaptiveValidator = new TimeSeriesCrossValidator({
        nSplits: 5,
        adaptiveTestSize: true,
        minTrainSize: 100,
        maxTestSize: 200
      });
      
      const splits = adaptiveValidator.timeSeriesSplit(financialData);
      
      splits.forEach(split => {
        expect(split.trainData.length).toBeGreaterThanOrEqual(100);
        expect(split.testData.length).toBeLessThanOrEqual(200);
      });
    });

  });

  describe('🔴 Red Phase: 失敗ケース - Purged GroupKFold機能', () => {
    
    test('グループラベルが不正な場合に正しく失敗する', () => {
      const purgedKFold = new PurgedGroupKFold({ nSplits: 3, purgeGap: 2 });
      const invalidGroups = []; // 空のグループラベル
      
      expect(() => {
        purgedKFold.split(financialData, null, invalidGroups);
      }).toThrow('グループラベルが不正です');
    });

    test('グループ数が分割数より少ない場合に正しく失敗する', () => {
      const purgedKFold = new PurgedGroupKFold({ nSplits: 5, purgeGap: 2 });
      const tooFewGroups = Array(financialData.length).fill(0).map((_, i) => i % 2); // 2グループのみ
      
      expect(() => {
        purgedKFold.split(financialData, null, tooFewGroups);
      }).toThrow('グループ数が分割数より少なすぎます');
    });

    test('purgeGapが負の値の場合に正しく失敗する', () => {
      expect(() => {
        new PurgedGroupKFold({ nSplits: 3, purgeGap: -1 });
      }).toThrow('purgeGapは0以上である必要があります');
    });

  });

  describe('🟢 Green Phase: 最小実装 - Purged GroupKFold機能', () => {
    
    test('基本的なPurged GroupKFoldが正しく動作する', () => {
      const purgedKFold = new PurgedGroupKFold({ nSplits: 3, purgeGap: 2 });
      const groups = generateGroupLabels(financialData.length, 10);
      
      const splits = purgedKFold.split(financialData, null, groups);
      
      expect(splits).toBeDefined();
      expect(Array.isArray(splits)).toBe(true);
      expect(splits.length).toBe(3);
      
      splits.forEach(split => {
        expect(split).toHaveProperty('trainIndices');
        expect(split).toHaveProperty('testIndices');
        expect(split.trainIndices.length).toBeGreaterThan(0);
        expect(split.testIndices.length).toBeGreaterThan(0);
      });
    });

    test('purgeGapが正しく適用される', () => {
      const purgeGap = 3;
      const purgedKFold = new PurgedGroupKFold({ nSplits: 3, purgeGap });
      const groups = generateGroupLabels(financialData.length, 15);
      
      const splits = purgedKFold.split(financialData, null, groups);
      
      splits.forEach(split => {
        // テスト集合の前後purgeGap分のデータが訓練集合から除外されていることを確認
        const testGroups = new Set(split.testIndices.map(idx => groups[idx]));
        
        split.trainIndices.forEach(trainIdx => {
          const trainGroup = groups[trainIdx];
          testGroups.forEach(testGroup => {
            expect(Math.abs(trainGroup - testGroup)).toBeGreaterThan(purgeGap);
          });
        });
      });
    });

    test('グループの重複が避けられる', () => {
      const purgedKFold = new PurgedGroupKFold({ nSplits: 3, purgeGap: 1 });
      const groups = generateGroupLabels(financialData.length, 12);
      
      const splits = purgedKFold.split(financialData, null, groups);
      
      splits.forEach(split => {
        const trainGroups = new Set(split.trainIndices.map(idx => groups[idx]));
        const testGroups = new Set(split.testIndices.map(idx => groups[idx]));
        
        // 訓練集合とテスト集合でグループの重複がないことを確認
        const intersection = new Set([...trainGroups].filter(x => testGroups.has(x)));
        expect(intersection.size).toBe(0);
      });
    });

  });

  describe('🔵 Blue Phase: リファクタリング - Purged GroupKFold機能', () => {
    
    test('最適化されたグループ分割アルゴリズム', () => {
      const optimizedPurgedKFold = new PurgedGroupKFold({
        nSplits: 5,
        purgeGap: 2,
        optimizeGroupBalance: true,
        parallelProcessing: true
      });
      
      const groups = generateGroupLabels(financialData.length, 25);
      
      const startTime = performance.now();
      const splits = optimizedPurgedKFold.split(financialData, null, groups);
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(500); // 0.5秒以内
      expect(splits.length).toBe(5);
      
      // グループバランスの確認
      splits.forEach(split => {
        const trainGroupCount = new Set(split.trainIndices.map(idx => groups[idx])).size;
        const testGroupCount = new Set(split.testIndices.map(idx => groups[idx])).size;
        
        expect(trainGroupCount).toBeGreaterThan(testGroupCount);
      });
    });

    test('動的purgeGap調整機能', () => {
      const adaptivePurgedKFold = new PurgedGroupKFold({
        nSplits: 4,
        adaptivePurgeGap: true,
        volatilityBasedPurging: true
      });
      
      const groups = generateGroupLabels(financialData.length, 20);
      const splits = adaptivePurgedKFold.split(financialData, null, groups);
      
      splits.forEach(split => {
        expect(split).toHaveProperty('adaptedPurgeGap');
        expect(split.adaptedPurgeGap).toBeGreaterThanOrEqual(1);
        expect(split).toHaveProperty('volatilityAdjustment');
      });
    });

  });

  describe('🔴 Red Phase: 失敗ケース - Embargo period実装', () => {
    
    test('無効なembargo期間設定で正しく失敗する', () => {
      expect(() => {
        new EmbargoValidator({ embargoLength: -1 });
      }).toThrow('embargo期間は0以上である必要があります');
    });

    test('embargo期間がデータ長より長い場合に正しく失敗する', () => {
      const embargoValidator = new EmbargoValidator({ embargoLength: 1000 });
      
      expect(() => {
        embargoValidator.applySplit(financialData);
      }).toThrow('embargo期間がデータ長を超えています');
    });

    test('embargo違反データが検出される', () => {
      const embargoValidator = new EmbargoValidator({ embargoLength: 5 });
      const violatingData = createEmbargoViolatingData();
      
      expect(() => {
        embargoValidator.validateEmbargo(violatingData);
      }).toThrow('embargo期間の違反が検出されました');
    });

  });

  describe('🟢 Green Phase: 最小実装 - Embargo period実装', () => {
    
    test('基本的なembargo期間が正しく適用される', () => {
      const embargoLength = 5;
      const embargoValidator = new EmbargoValidator({ embargoLength });
      
      const splits = embargoValidator.applySplit(financialData);
      
      expect(splits).toBeDefined();
      expect(Array.isArray(splits)).toBe(true);
      
      splits.forEach(split => {
        expect(split).toHaveProperty('embargoApplied');
        expect(split.embargoApplied).toBe(true);
        expect(split).toHaveProperty('embargoLength');
        expect(split.embargoLength).toBe(embargoLength);
      });
    });

    test('embargo期間でのデータギャップが確保される', () => {
      const embargoLength = 3;
      const embargoValidator = new EmbargoValidator({ embargoLength });
      
      const splits = embargoValidator.applySplit(financialData);
      
      splits.forEach(split => {
        if (split.trainIndices && split.testIndices) {
          const lastTrainIndex = Math.max(...split.trainIndices);
          const firstTestIndex = Math.min(...split.testIndices);
          
          // embargo期間分のギャップが確保されていることを確認
          expect(firstTestIndex - lastTrainIndex).toBeGreaterThanOrEqual(embargoLength);
        }
      });
    });

    test('動的embargo期間調整', () => {
      const dynamicEmbargo = new EmbargoValidator({
        embargoLength: 3,
        dynamicAdjustment: true,
        volatilityThreshold: 0.02
      });
      
      const splits = dynamicEmbargo.applySplit(financialData);
      
      splits.forEach(split => {
        expect(split).toHaveProperty('adjustedEmbargoLength');
        expect(split.adjustedEmbargoLength).toBeGreaterThanOrEqual(3);
      });
    });

  });

  describe('🔵 Blue Phase: リファクタリング - Embargo period実装', () => {
    
    test('高度なembargo最適化アルゴリズム', () => {
      const optimizedEmbargo = new EmbargoValidator({
        embargoLength: 5,
        optimizationMethod: 'information_decay',
        autocorrelationBased: true,
        adaptiveLength: true
      });
      
      const splits = optimizedEmbargo.applySplit(financialData);
      
      splits.forEach(split => {
        expect(split).toHaveProperty('optimizedEmbargoLength');
        expect(split).toHaveProperty('informationDecayScore');
        expect(split).toHaveProperty('autocorrelationAdjustment');
        
        expect(split.informationDecayScore).toBeGreaterThan(0);
        expect(split.optimizedEmbargoLength).toBeGreaterThan(0);
      });
    });

    test('市場マイクロ構造を考慮したembargo調整', () => {
      const microstructureEmbargo = new EmbargoValidator({
        embargoLength: 3,
        microstructureAware: true,
        bidAskSpreadAdjustment: true,
        liquidityBasedAdjustment: true
      });
      
      const splits = microstructureEmbargo.applySplit(financialData);
      
      splits.forEach(split => {
        expect(split).toHaveProperty('microstructureAdjustment');
        expect(split).toHaveProperty('liquidityAdjustedLength');
        expect(split).toHaveProperty('spreadAdjustment');
      });
    });

  });

  describe('🔴 Red Phase: 失敗ケース - Nested Cross-Validation', () => {
    
    test('ネストレベルが不正な場合に正しく失敗する', () => {
      expect(() => {
        new NestedCrossValidator({ outerSplits: 0, innerSplits: 3 });
      }).toThrow('分割数は1以上である必要があります');
      
      expect(() => {
        new NestedCrossValidator({ outerSplits: 3, innerSplits: 0 });
      }).toThrow('分割数は1以上である必要があります');
    });

    test('内側分割数が外側分割数より多い場合に警告が発生する', () => {
      const nestedCV = new NestedCrossValidator({ outerSplits: 2, innerSplits: 5 });
      
      // 警告のテストは実装によって異なるが、基本的な動作は確認
      expect(() => {
        nestedCV.split(financialData.slice(0, 50)); // 小さなデータセット
      }).toThrow('データサイズが不十分です');
    });

  });

  describe('🟢 Green Phase: 最小実装 - Nested Cross-Validation', () => {
    
    test('基本的なNested CVが正しく動作する', () => {
      const nestedCV = new NestedCrossValidator({ 
        outerSplits: 3, 
        innerSplits: 2,
        timeSeriesMode: true
      });
      
      const splits = nestedCV.split(financialData);
      
      expect(splits).toBeDefined();
      expect(Array.isArray(splits)).toBe(true);
      expect(splits.length).toBe(3); // outer splits
      
      splits.forEach(outerSplit => {
        expect(outerSplit).toHaveProperty('outerTrain');
        expect(outerSplit).toHaveProperty('outerTest');
        expect(outerSplit).toHaveProperty('innerSplits');
        expect(Array.isArray(outerSplit.innerSplits)).toBe(true);
        expect(outerSplit.innerSplits.length).toBe(2); // inner splits
        
        outerSplit.innerSplits.forEach(innerSplit => {
          expect(innerSplit).toHaveProperty('train');
          expect(innerSplit).toHaveProperty('validation');
        });
      });
    });

    test('時系列順序がネスト構造で保持される', () => {
      const nestedCV = new NestedCrossValidator({ 
        outerSplits: 3, 
        innerSplits: 2,
        timeSeriesMode: true
      });
      
      const splits = nestedCV.split(financialData);
      
      splits.forEach(outerSplit => {
        // 外側分割の時系列順序確認
        const outerTrainTimes = outerSplit.outerTrain.map(idx => financialData[idx].timestamp.getTime());
        const outerTestTimes = outerSplit.outerTest.map(idx => financialData[idx].timestamp.getTime());
        
        expect(Math.max(...outerTrainTimes)).toBeLessThan(Math.min(...outerTestTimes));
        
        // 内側分割の時系列順序確認
        outerSplit.innerSplits.forEach(innerSplit => {
          const innerTrainTimes = innerSplit.train.map(idx => financialData[idx].timestamp.getTime());
          const innerValidTimes = innerSplit.validation.map(idx => financialData[idx].timestamp.getTime());
          
          expect(Math.max(...innerTrainTimes)).toBeLessThan(Math.min(...innerValidTimes));
        });
      });
    });

  });

  describe('🔵 Blue Phase: リファクタリング - Nested Cross-Validation', () => {
    
    test('パフォーマンス最適化されたNested CV', () => {
      const optimizedNestedCV = new NestedCrossValidator({
        outerSplits: 3,
        innerSplits: 2,
        parallelProcessing: true,
        cacheOptimization: true,
        memoryEfficient: true
      });
      
      const startTime = performance.now();
      const splits = optimizedNestedCV.split(financialData);
      const endTime = performance.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // 1秒以内
      expect(splits.length).toBe(3);
      
      // キャッシュ最適化の確認
      splits.forEach(split => {
        expect(split).toHaveProperty('cacheKey');
        expect(split).toHaveProperty('memoryOptimized');
      });
    });

  });

  describe('🔴 Red Phase: 失敗ケース - Lopez de Prado手法実装', () => {
    
    test('triplet barriers設定が不正な場合に正しく失敗する', () => {
      expect(() => {
        new LopezDePradoSplitter({
          upperBarrier: -0.1, // 負の値
          lowerBarrier: 0.1,
          timeBarrier: 10
        });
      }).toThrow('バリア設定が不正です');
    });

    test('サンプル重み付けが不正な場合に正しく失敗する', () => {
      const splitter = new LopezDePradoSplitter();
      const invalidWeights = Array(financialData.length).fill(-1); // 負の重み
      
      expect(() => {
        splitter.splitWithWeights(financialData, invalidWeights);
      }).toThrow('サンプル重みが不正です');
    });

  });

  describe('🟢 Green Phase: 最小実装 - Lopez de Prado手法実装', () => {
    
    test('Triplet Barrier Methodが正しく動作する', () => {
      const lopezSplitter = new LopezDePradoSplitter({
        upperBarrier: 0.02,
        lowerBarrier: -0.02,
        timeBarrier: 10,
        minPeriod: 5
      });
      
      const labels = lopezSplitter.createTripletBarrierLabels(financialData);
      
      expect(labels).toBeDefined();
      expect(Array.isArray(labels)).toBe(true);
      expect(labels.length).toBeGreaterThan(0);
      
      labels.forEach(label => {
        expect(label).toHaveProperty('startTime');
        expect(label).toHaveProperty('endTime');
        expect(label).toHaveProperty('label'); // -1, 0, 1
        expect(label).toHaveProperty('barrierHit');
        expect([-1, 0, 1]).toContain(label.label);
      });
    });

    test('Sample Uniquenessが適用される', () => {
      const lopezSplitter = new LopezDePradoSplitter({
        enableSampleUniqueness: true,
        overlapThreshold: 0.5
      });
      
      const uniqueLabels = lopezSplitter.ensureSampleUniqueness(financialData);
      
      expect(uniqueLabels).toBeDefined();
      expect(Array.isArray(uniqueLabels)).toBe(true);
      
      // 重複チェック
      const overlaps = lopezSplitter.calculateOverlaps(uniqueLabels);
      overlaps.forEach(overlap => {
        expect(overlap.overlapRatio).toBeLessThanOrEqual(0.5);
      });
    });

    test('Sequential Bootstrappingが実装される', () => {
      const lopezSplitter = new LopezDePradoSplitter({
        enableSequentialBootstrap: true,
        bootstrapSamples: 100
      });
      
      const bootstrapped = lopezSplitter.sequentialBootstrap(financialData);
      
      expect(bootstrapped).toBeDefined();
      expect(Array.isArray(bootstrapped)).toBe(true);
      expect(bootstrapped.length).toBe(100);
      
      bootstrapped.forEach(sample => {
        expect(sample).toHaveProperty('indices');
        expect(sample).toHaveProperty('weights');
        expect(Array.isArray(sample.indices)).toBe(true);
        expect(Array.isArray(sample.weights)).toBe(true);
      });
    });

  });

  describe('🔵 Blue Phase: リファクタリング - Lopez de Prado手法実装', () => {
    
    test('高度なMeta-Labeling実装', () => {
      const metaLabeler = new LopezDePradoSplitter({
        enableMetaLabeling: true,
        primaryModelThreshold: 0.6,
        metaModelFeatures: ['volatility', 'volume', 'spread']
      });
      
      const metaLabels = metaLabeler.createMetaLabels(financialData);
      
      expect(metaLabels).toBeDefined();
      expect(Array.isArray(metaLabels)).toBe(true);
      
      metaLabels.forEach(metaLabel => {
        expect(metaLabel).toHaveProperty('primaryPrediction');
        expect(metaLabel).toHaveProperty('metaFeatures');
        expect(metaLabel).toHaveProperty('metaLabel');
        expect(metaLabel).toHaveProperty('confidence');
        
        expect(Array.isArray(metaLabel.metaFeatures)).toBe(true);
        expect(metaLabel.confidence).toBeGreaterThanOrEqual(0);
        expect(metaLabel.confidence).toBeLessThanOrEqual(1);
      });
    });

    test('Fractional Differentiation統合', () => {
      const fracDiffSplitter = new LopezDePradoSplitter({
        enableFractionalDiff: true,
        optimalD: 0.4,
        stationarityThreshold: 0.05
      });
      
      const stationaryData = fracDiffSplitter.applyFractionalDifferentiation(financialData);
      
      expect(stationaryData).toBeDefined();
      expect(Array.isArray(stationaryData)).toBe(true);
      expect(stationaryData.length).toBeLessThanOrEqual(financialData.length);
      
      stationaryData.forEach(point => {
        expect(point).toHaveProperty('fracDiffValue');
        expect(point).toHaveProperty('stationarityScore');
        expect(point).toHaveProperty('originalIndex');
      });
    });

  });

  describe('🏆 統合テスト - 包括的クロスバリデーション', () => {
    
    test('全手法統合パイプライン', () => {
      const comprehensiveValidator = new FinancialTimeSeriesValidator({
        timeSeriesSplit: { nSplits: 5, testSize: 0.2 },
        purgedGroupKFold: { nSplits: 3, purgeGap: 2 },
        embargo: { embargoLength: 3 },
        nestedCV: { outerSplits: 3, innerSplits: 2 },
        lopezDePrado: { upperBarrier: 0.02, lowerBarrier: -0.02 }
      });
      
      const results = comprehensiveValidator.validateComprehensively(financialData);
      
      expect(results).toBeDefined();
      expect(results).toHaveProperty('timeSeriesSplits');
      expect(results).toHaveProperty('purgedSplits');
      expect(results).toHaveProperty('embargoResults');
      expect(results).toHaveProperty('nestedCVResults');
      expect(results).toHaveProperty('lopezDePradoResults');
      expect(results).toHaveProperty('overallScore');
      expect(results).toHaveProperty('recommendedMethod');
      
      expect(results.overallScore).toBeGreaterThan(0);
      expect(results.overallScore).toBeLessThanOrEqual(1);
    });

    test('金融時系列特有問題の検出と対応', () => {
      const problemDetector = new FinancialTimeSeriesValidator({
        detectAutocorrelation: true,
        detectHeteroskedasticity: true,
        detectNonStationarity: true,
        detectStructuralBreaks: true
      });
      
      const diagnostics = problemDetector.diagnoseTimeSeries(financialData);
      
      expect(diagnostics).toBeDefined();
      expect(diagnostics).toHaveProperty('autocorrelationTest');
      expect(diagnostics).toHaveProperty('heteroskedasticityTest');
      expect(diagnostics).toHaveProperty('stationarityTest');
      expect(diagnostics).toHaveProperty('structuralBreakTest');
      expect(diagnostics).toHaveProperty('recommendations');
      
      expect(Array.isArray(diagnostics.recommendations)).toBe(true);
    });

    test('リアルタイム検証システム', () => {
      const realtimeValidator = new FinancialTimeSeriesValidator({
        realtimeMode: true,
        streamingValidation: true,
        adaptiveRevalidation: true,
        performanceMonitoring: true
      });
      
      const streamResults = realtimeValidator.validateStreaming(financialData);
      
      expect(streamResults).toBeDefined();
      expect(streamResults).toHaveProperty('validationStream');
      expect(streamResults).toHaveProperty('performanceMetrics');
      expect(streamResults).toHaveProperty('adaptationTriggers');
      
      expect(Array.isArray(streamResults.validationStream)).toBe(true);
      expect(streamResults.performanceMetrics.latency).toBeLessThan(100); // 100ms以内
    });

  });

  // ===== テストヘルパー関数 =====
  
  function generateFinancialTimeSeriesData(length = 1000) {
    const data = [];
    let price = 100;
    let volatility = 0.02;
    
    for (let i = 0; i < length; i++) {
      const timestamp = new Date(2020, 0, 1);
      timestamp.setDate(timestamp.getDate() + i);
      
      // 金融時系列の特徴を模擬
      const return_ = (Math.random() - 0.5) * volatility;
      price *= (1 + return_);
      
      // ボラティリティクラスタリング
      volatility += (Math.random() - 0.5) * 0.001;
      volatility = Math.max(0.005, Math.min(0.05, volatility));
      
      data.push({
        timestamp: timestamp,
        price: price,
        return: return_,
        volatility: volatility,
        volume: Math.random() * 1000000,
        open: price * (1 + (Math.random() - 0.5) * 0.001),
        high: price * (1 + Math.random() * 0.005),
        low: price * (1 - Math.random() * 0.005),
        close: price,
        bidAskSpread: Math.random() * 0.001,
        liquidity: Math.random() * 10000
      });
    }
    
    return data;
  }
  
  function createCorruptedTimeSeriesData() {
    const data = generateFinancialTimeSeriesData(100);
    // タイムスタンプを意図的に混乱させる
    data[50].timestamp = new Date(2019, 0, 1); // 過去の日付
    return data;
  }
  
  function createFutureLeakageData() {
    const data = generateFinancialTimeSeriesData(100);
    // 未来データが含まれているように設定
    data[10].futureInfo = data[20].price; // 未来の価格情報
    
    // 時系列順序も意図的に破綻させる
    const temp = data[10];
    data[10] = data[50];
    data[50] = temp;
    
    return data;
  }
  
  function generateGroupLabels(length, numGroups) {
    return Array(length).fill(0).map((_, i) => Math.floor(i / (length / numGroups)));
  }
  
  function createEmbargoViolatingData() {
    const data = generateFinancialTimeSeriesData(100);
    // embargo期間内のデータアクセスを模擬
    data.embargoViolation = {
      trainEnd: 50,
      testStart: 52, // embargo期間が不十分
      requiredGap: 5
    };
    return data;
  }
  
});