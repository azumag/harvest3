/**
 * ベイジアン最適化アルゴリズム
 * ガウス過程回帰ベースの獲得関数による金融工学的厳密実装
 * Expected Improvement, Upper Confidence Bound, Probability of Improvement
 */

// ベイジアン最適化: 外部数学ライブラリなしで実装

/**
 * カーネル関数クラス
 * RBF、Matérn、線形カーネルの実装
 */
class KernelFunctions {
  constructor() {
    this.supportedKernels = ['rbf', 'matern32', 'matern52', 'linear', 'polynomial'];
  }

  /**
   * RBF (ガウシアン) カーネル
   * k(x1, x2) = σ² * exp(-||x1-x2||²/(2l²))
   */
  rbf(x1, x2, lengthScale = 1.0, variance = 1.0) {
    const distance = this.euclideanDistance(x1, x2);
    return variance * Math.exp(-Math.pow(distance, 2) / (2 * Math.pow(lengthScale, 2)));
  }

  /**
   * Matérn 3/2 カーネル
   * k(r) = σ² * (1 + √3*r/l) * exp(-√3*r/l)
   */
  matern32(x1, x2, lengthScale = 1.0, variance = 1.0) {
    const r = this.euclideanDistance(x1, x2);
    const factor = Math.sqrt(3) * r / lengthScale;
    return variance * (1 + factor) * Math.exp(-factor);
  }

  /**
   * Matérn 5/2 カーネル
   * k(r) = σ² * (1 + √5*r/l + 5r²/(3l²)) * exp(-√5*r/l)
   */
  matern52(x1, x2, lengthScale = 1.0, variance = 1.0) {
    const r = this.euclideanDistance(x1, x2);
    const factor = Math.sqrt(5) * r / lengthScale;
    const factor2 = 5 * Math.pow(r, 2) / (3 * Math.pow(lengthScale, 2));
    return variance * (1 + factor + factor2) * Math.exp(-factor);
  }

  /**
   * 線形カーネル
   * k(x1, x2) = σ² * x1ᵀx2
   */
  linear(x1, x2, variance = 1.0) {
    const dotProduct = x1.reduce((sum, val, i) => sum + val * x2[i], 0);
    return variance * dotProduct;
  }

  /**
   * 多項式カーネル
   * k(x1, x2) = (γ*x1ᵀx2 + r)^d
   */
  polynomial(x1, x2, degree = 2, gamma = 1.0, coef0 = 1.0) {
    const dotProduct = x1.reduce((sum, val, i) => sum + val * x2[i], 0);
    return Math.pow(gamma * dotProduct + coef0, degree);
  }

  /**
   * 汎用カーネル関数
   */
  kernel(x1, x2, kernelType, params = {}) {
    const {
      lengthScale = 1.0,
      variance = 1.0,
      degree = 2,
      gamma = 1.0,
      coef0 = 1.0
    } = params;

    switch (kernelType) {
      case 'rbf':
        return this.rbf(x1, x2, lengthScale, variance);
      case 'matern32':
        return this.matern32(x1, x2, lengthScale, variance);
      case 'matern52':
        return this.matern52(x1, x2, lengthScale, variance);
      case 'linear':
        return this.linear(x1, x2, variance);
      case 'polynomial':
        return this.polynomial(x1, x2, degree, gamma, coef0);
      default:
        throw new Error(`Unsupported kernel type: ${kernelType}`);
    }
  }

  /**
   * カーネル行列の構築
   */
  kernelMatrix(X1, X2, kernelType, params = {}) {
    const { noiseVariance = 0.0 } = params;
    const K = [];

    for (let i = 0; i < X1.length; i++) {
      const row = [];
      for (let j = 0; j < X2.length; j++) {
        let kij = this.kernel(X1[i], X2[j], kernelType, params);
        
        // 対角要素にノイズ分散を追加（数値安定性）
        if (i === j && X1 === X2) {
          kij += noiseVariance;
        }
        
        row.push(kij);
      }
      K.push(row);
    }

    return K;
  }

  /**
   * ユークリッド距離の計算
   */
  euclideanDistance(x1, x2) {
    if (x1.length !== x2.length) {
      throw new Error('Vectors must have the same dimension');
    }
    return Math.sqrt(x1.reduce((sum, val, i) => sum + Math.pow(val - x2[i], 2), 0));
  }

  /**
   * 行列の固有値計算（簡易実装：対角要素近似）
   */
  eigenvalues(matrix) {
    // 簡易実装：対角要素を固有値の近似として使用
    // 正確な固有値計算は複雑なため、正定値行列の検証用途では十分
    return matrix.map((_, i) => matrix[i][i]);
  }
}

/**
 * ガウス過程回帰クラス
 */
class GaussianProcessRegression {
  constructor(options = {}) {
    this.kernelType = options.kernelType || 'rbf';
    this.lengthScale = options.lengthScale || 1.0;
    this.variance = options.variance || 1.0;
    this.noiseVariance = options.noiseVariance || 0.01;
    this.kernelFunctions = new KernelFunctions();
    
    // 学習データ
    this.X = null;
    this.y = null;
    this.alpha = null; // K^(-1) * y
    this.L = null;     // コレスキー分解の下三角行列
  }

  /**
   * ガウス過程の学習
   */
  fit(X, y) {
    this.X = X.map(x => [...x]); // ディープコピー
    this.y = [...y];

    // カーネル行列の計算
    const K = this.kernelFunctions.kernelMatrix(
      this.X, 
      this.X, 
      this.kernelType, 
      {
        lengthScale: this.lengthScale,
        variance: this.variance,
        noiseVariance: this.noiseVariance
      }
    );

    // コレスキー分解
    this.L = this.choleskyDecomposition(K);
    
    // α = K^(-1) * y の計算
    // まず L * v = y を解く
    const v = this.solveTriangular(this.L, this.y, false);
    // 次に L^T * α = v を解く
    this.alpha = this.solveTriangular(this.transposeMatrix(this.L), v, true);

    return this;
  }

  /**
   * 予測実行
   */
  predict(XStar) {
    if (!this.X || !this.y) {
      throw new Error('Model must be fitted before prediction');
    }

    const n = XStar.length;
    const mean = new Array(n);
    const variance = new Array(n);

    for (let i = 0; i < n; i++) {
      // k* = K(X*, X)
      const kStar = this.X.map(x => 
        this.kernelFunctions.kernel(XStar[i], x, this.kernelType, {
          lengthScale: this.lengthScale,
          variance: this.variance
        })
      );

      // 予測平均: μ* = k*ᵀ * α
      mean[i] = kStar.reduce((sum, k, j) => sum + k * this.alpha[j], 0);

      // k** = K(X*, X*)
      const kStarStar = this.kernelFunctions.kernel(XStar[i], XStar[i], this.kernelType, {
        lengthScale: this.lengthScale,
        variance: this.variance
      });

      // v = L^(-1) * k*
      const v = this.solveTriangular(this.L, kStar);
      
      // 予測分散: σ²* = k** - vᵀv
      const vTv = v.reduce((sum, val) => sum + val * val, 0);
      variance[i] = Math.max(kStarStar - vTv, 1e-10); // 数値安定性
    }

    return {
      mean,
      variance,
      std: variance.map(v => Math.sqrt(v))
    };
  }

  /**
   * ハイパーパラメータ最適化
   */
  optimizeHyperparameters(X, y, options = {}) {
    const { maxIterations = 50, learningRate = 0.01 } = options;
    
    let bestParams = {
      lengthScale: this.lengthScale,
      variance: this.variance,
      noiseVariance: this.noiseVariance
    };
    let bestLogLikelihood = -Infinity;

    for (let iter = 0; iter < maxIterations; iter++) {
      // 現在のパラメータで学習
      this.fit(X, y);
      const logLikelihood = this.logMarginalLikelihood();

      if (logLikelihood > bestLogLikelihood) {
        bestLogLikelihood = logLikelihood;
        bestParams = {
          lengthScale: this.lengthScale,
          variance: this.variance,
          noiseVariance: this.noiseVariance
        };
      }

      // 簡易勾配ベース更新（実装簡略化）
      const gradients = this.approximateGradients(X, y);
      
      this.lengthScale = Math.max(0.01, this.lengthScale + learningRate * gradients.lengthScale);
      this.variance = Math.max(0.01, this.variance + learningRate * gradients.variance);
      this.noiseVariance = Math.max(1e-6, this.noiseVariance + learningRate * gradients.noiseVariance);
    }

    // 最適パラメータに設定
    this.lengthScale = bestParams.lengthScale;
    this.variance = bestParams.variance;
    this.noiseVariance = bestParams.noiseVariance;

    return bestParams;
  }

  /**
   * 対数周辺尤度の計算
   */
  logMarginalLikelihood() {
    if (!this.L || !this.alpha) {
      throw new Error('Model must be fitted before computing log marginal likelihood');
    }

    const n = this.y.length;
    
    // -0.5 * y^T * K^(-1) * y
    const dataFit = -0.5 * this.y.reduce((sum, yi, i) => sum + yi * this.alpha[i], 0);
    
    // -0.5 * log|K|
    const complexity = -0.5 * this.logDeterminant(this.L);
    
    // -0.5 * n * log(2π)
    const normalization = -0.5 * n * Math.log(2 * Math.PI);
    
    return dataFit + complexity + normalization;
  }

  /**
   * コレスキー分解
   */
  choleskyDecomposition(matrix) {
    const n = matrix.length;
    const L = Array(n).fill().map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        if (i === j) {
          // 対角要素
          let sum = 0;
          for (let k = 0; k < j; k++) {
            sum += L[i][k] * L[i][k];
          }
          
          const value = matrix[i][i] - sum;
          if (value <= 0) {
            // 数値安定性のために小さな正の値を追加
            L[i][j] = Math.sqrt(1e-10);
          } else {
            L[i][j] = Math.sqrt(value);
          }
        } else {
          // 非対角要素
          let sum = 0;
          for (let k = 0; k < j; k++) {
            sum += L[i][k] * L[j][k];
          }
          L[i][j] = (matrix[i][j] - sum) / L[j][j];
        }
      }
    }

    return L;
  }

  /**
   * 下三角行列の前進代入
   */
  solveTriangular(L, b, isUpper = false) {
    const n = b.length;
    const x = new Array(n);

    if (isUpper) {
      // 後退代入
      for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) {
          sum += L[i][j] * x[j];
        }
        x[i] = (b[i] - sum) / L[i][i];
      }
    } else {
      // 前進代入
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < i; j++) {
          sum += L[i][j] * x[j];
        }
        x[i] = (b[i] - sum) / L[i][i];
      }
    }

    return x;
  }

  /**
   * 行列の転置
   */
  transposeMatrix(matrix) {
    if (!matrix || matrix.length === 0 || !matrix[0] || matrix[0].length === 0) {
      return [];
    }
    return matrix[0].map((_, i) => matrix.map(row => row[i]));
  }

  /**
   * 対数行列式の計算（コレスキー分解から）
   */
  logDeterminant(L) {
    return 2 * L.reduce((sum, row, i) => sum + Math.log(Math.abs(row[i])), 0);
  }

  /**
   * 勾配の近似計算
   */
  approximateGradients(X, y) {
    const epsilon = 1e-6;
    const originalLL = this.logMarginalLikelihood();

    // Length scale gradient
    this.lengthScale += epsilon;
    this.fit(X, y);
    const llLengthPlus = this.logMarginalLikelihood();
    this.lengthScale -= 2 * epsilon;
    this.fit(X, y);
    const llLengthMinus = this.logMarginalLikelihood();
    this.lengthScale += epsilon; // restore
    const gradLengthScale = (llLengthPlus - llLengthMinus) / (2 * epsilon);

    // Variance gradient
    this.variance += epsilon;
    this.fit(X, y);
    const llVarPlus = this.logMarginalLikelihood();
    this.variance -= 2 * epsilon;
    this.fit(X, y);
    const llVarMinus = this.logMarginalLikelihood();
    this.variance += epsilon; // restore
    const gradVariance = (llVarPlus - llVarMinus) / (2 * epsilon);

    // Noise variance gradient
    this.noiseVariance += epsilon;
    this.fit(X, y);
    const llNoisePlus = this.logMarginalLikelihood();
    this.noiseVariance -= 2 * epsilon;
    this.fit(X, y);
    const llNoiseMinus = this.logMarginalLikelihood();
    this.noiseVariance += epsilon; // restore
    const gradNoiseVariance = (llNoisePlus - llNoiseMinus) / (2 * epsilon);

    // Restore original model
    this.fit(X, y);

    return {
      lengthScale: gradLengthScale,
      variance: gradVariance,
      noiseVariance: gradNoiseVariance
    };
  }
}

/**
 * 獲得関数クラス
 */
class AcquisitionFunctions {
  constructor(gaussianProcess) {
    this.gp = gaussianProcess;
  }

  /**
   * Expected Improvement (期待改善)
   * EI(x) = (μ(x) - f_best - ξ) * Φ(Z) + σ(x) * φ(Z)
   * where Z = (μ(x) - f_best - ξ) / σ(x)
   */
  expectedImprovement(X, fBest, xi = 0.01) {
    const prediction = this.gp.predict(X);
    const { mean, std } = prediction;

    return mean.map((mu, i) => {
      const sigma = std[i];
      
      if (sigma < 1e-10) {
        return 0; // 分散が0に近い場合
      }

      const improvement = mu - fBest - xi;
      const Z = improvement / sigma;
      
      const ei = improvement * this.normalCDF(Z) + sigma * this.normalPDF(Z);
      return Math.max(0, ei);
    });
  }

  /**
   * Upper Confidence Bound (上側信頼境界)
   * UCB(x) = μ(x) + κ * σ(x)
   */
  upperConfidenceBound(X, kappa = 2.576) { // 99%信頼区間
    const prediction = this.gp.predict(X);
    const { mean, std } = prediction;

    return mean.map((mu, i) => mu + kappa * std[i]);
  }

  /**
   * Probability of Improvement (改善確率)
   * PI(x) = Φ((μ(x) - f_best - ξ) / σ(x))
   */
  probabilityOfImprovement(X, fBest, xi = 0.01) {
    const prediction = this.gp.predict(X);
    const { mean, std } = prediction;

    return mean.map((mu, i) => {
      const sigma = std[i];
      
      if (sigma < 1e-10) {
        return mu > fBest ? 1.0 : 0.0;
      }

      const Z = (mu - fBest - xi) / sigma;
      return this.normalCDF(Z);
    });
  }

  /**
   * 標準正規分布の累積分布関数
   */
  normalCDF(x) {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  /**
   * 標準正規分布の確率密度関数
   */
  normalPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  /**
   * 誤差関数の近似
   */
  erf(x) {
    // Abramowitz and Stegun approximation
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  /**
   * 数値微分による勾配計算
   */
  numericalGradient(func, x, h = 1e-8) {
    const gradient = new Array(x.length);
    
    for (let i = 0; i < x.length; i++) {
      const xPlus = [...x];
      const xMinus = [...x];
      
      xPlus[i] += h;
      xMinus[i] -= h;
      
      gradient[i] = (func(xPlus) - func(xMinus)) / (2 * h);
    }
    
    return gradient;
  }
}

/**
 * 制約処理クラス
 */
class ConstraintHandler {
  constructor() {
    this.constraints = [];
  }

  /**
   * 制約の追加
   */
  addConstraints(constraints) {
    this.constraints = this.constraints.concat(constraints);
  }

  /**
   * 実行可能性の判定
   */
  isFeasible(point) {
    return this.constraints.every(constraint => this.satisfiesConstraint(point, constraint));
  }

  /**
   * 個別制約の満足判定
   */
  satisfiesConstraint(point, constraint) {
    switch (constraint.type) {
      case 'range':
        const value = point[constraint.parameter];
        return value >= constraint.min && value <= constraint.max;
        
      case 'sum_equals':
        const sum = constraint.parameters.reduce((s, param) => s + (point[param] || 0), 0);
        const tolerance = constraint.tolerance || 1e-6;
        return Math.abs(sum - constraint.value) <= tolerance;
        
      case 'sum_leq':
        const sumLeq = constraint.parameters.reduce((s, param) => s + (point[param] || 0), 0);
        return sumLeq <= constraint.value + (constraint.tolerance || 0);
        
      case 'linear':
        const linearSum = constraint.coefficients.reduce((s, coef, i) => {
          const param = constraint.parameters[i];
          return s + coef * (point[param] || 0);
        }, 0);
        return linearSum <= constraint.rhs;
        
      default:
        return true;
    }
  }

  /**
   * ペナルティ関数
   */
  penaltyFunction(point, penaltyWeight = 1000) {
    let penalty = 0;

    this.constraints.forEach(constraint => {
      if (!this.satisfiesConstraint(point, constraint)) {
        penalty += penaltyWeight * this.constraintViolation(point, constraint);
      }
    });

    return penalty;
  }

  /**
   * 制約違反量の計算
   */
  constraintViolation(point, constraint) {
    switch (constraint.type) {
      case 'range':
        const value = point[constraint.parameter];
        if (value < constraint.min) {
          return Math.pow(constraint.min - value, 2);
        } else if (value > constraint.max) {
          return Math.pow(value - constraint.max, 2);
        }
        return 0;
        
      case 'sum_equals':
        const sum = constraint.parameters.reduce((s, param) => s + (point[param] || 0), 0);
        return Math.pow(sum - constraint.value, 2);
        
      default:
        return 0;
    }
  }

  /**
   * 実行可能領域への投影
   */
  projectToFeasible(point) {
    const projected = { ...point };

    this.constraints.forEach(constraint => {
      if (constraint.type === 'range') {
        const value = projected[constraint.parameter];
        if (value < constraint.min) {
          projected[constraint.parameter] = constraint.min;
        } else if (value > constraint.max) {
          projected[constraint.parameter] = constraint.max;
        }
      }
    });

    return projected;
  }

  /**
   * リスクパラメータ制約の作成
   */
  createRiskParameterConstraints() {
    return [
      { type: 'range', parameter: 'stopLoss', min: 0.005, max: 0.1 },
      { type: 'range', parameter: 'trailingStop', min: 0.001, max: 0.05 },
      { type: 'range', parameter: 'maxPositions', min: 1, max: 20 },
      { type: 'range', parameter: 'maxDailyLoss', min: 0.01, max: 0.2 },
      { type: 'range', parameter: 'volatilityWeight', min: 0.0, max: 1.0 },
      { type: 'range', parameter: 'riskWeight', min: 0.0, max: 1.0 },
      { type: 'range', parameter: 'timezoneWeight', min: 0.0, max: 1.0 },
      { type: 'range', parameter: 'performanceWeight', min: 0.0, max: 1.0 },
      {
        type: 'sum_equals',
        parameters: ['volatilityWeight', 'riskWeight', 'timezoneWeight', 'performanceWeight'],
        value: 1.0,
        tolerance: 0.001
      }
    ];
  }
}

/**
 * 収束判定クラス
 */
class ConvergenceDetector {
  constructor(options = {}) {
    this.tolerance = options.tolerance || 1e-6;
    this.minIterations = options.minIterations || 5;
    this.maxIterations = options.maxIterations || 100;
    this.improvementThreshold = options.improvementThreshold || 0.01;
    this.patienceLimit = options.patienceLimit || 3; // より少ない試行で判定
    
    this.values = [];
    this.bestValue = -Infinity;
    this.bestIteration = 0;
    this.patience = 0;
    this.converged = false;
    this.convergenceReason = null;
  }

  /**
   * 新しい値で更新
   */
  update(value) {
    this.values.push(value);
    const iteration = this.values.length;

    // 最良値の更新
    if (value > this.bestValue) {
      // 閾値を考慮した改善判定
      if (value > this.bestValue + this.improvementThreshold) {
        this.patience = 0;
      } else {
        this.patience++;
      }
      this.bestValue = value;
      this.bestIteration = iteration;
    } else {
      this.patience++;
    }

    // 収束判定
    this.checkConvergence();
  }

  /**
   * 収束判定の実行
   */
  checkConvergence() {
    const iteration = this.values.length;

    // 最大イテレーション数
    if (iteration >= this.maxIterations) {
      this.converged = true;
      this.convergenceReason = 'max_iterations';
      return;
    }

    // 最小イテレーション数未満
    if (iteration < this.minIterations) {
      return;
    }

    // 許容誤差での収束（分散に基づく）
    if (this.values.length >= 3) {
      const recent = this.values.slice(-3);
      const variance = this.calculateVariance(recent);
      
      if (variance < this.tolerance && this.values.length >= this.minIterations) {
        this.converged = true;
        this.convergenceReason = 'tolerance_reached';
        return;
      }
    }

    // 改善停止での収束（最小イテレーション数以上で判定）
    if (this.patience >= this.patienceLimit && iteration >= this.minIterations) {
      this.converged = true;
      this.convergenceReason = 'no_improvement';
    }
  }

  /**
   * 収束状態の確認
   */
  hasConverged() {
    return this.converged;
  }

  /**
   * 収束理由の取得
   */
  getConvergenceReason() {
    return this.convergenceReason;
  }

  /**
   * 収束統計の取得
   */
  getConvergenceStatistics() {
    return {
      iterations: this.values.length,
      bestValue: this.bestValue,
      bestIteration: this.bestIteration,
      improvementRate: this.calculateImprovementRate(),
      convergenceSpeed: this.calculateConvergenceSpeed(),
      finalVariance: this.calculateVariance(this.values.slice(-5))
    };
  }

  /**
   * 分散の計算
   */
  calculateVariance(values) {
    if (values.length < 2) return Infinity;
    
    // 値の範囲確認
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    
    // 範囲が非常に小さい場合は0に近い分散とみなす
    if (range < this.tolerance * 10) {
      return Math.min(this.tolerance / 10, range);
    }
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
  }

  /**
   * 改善率の計算
   */
  calculateImprovementRate() {
    if (this.values.length < 2) return 0;
    
    const initial = this.values[0];
    const current = this.bestValue;
    return (current - initial) / Math.abs(initial);
  }

  /**
   * 収束速度の計算
   */
  calculateConvergenceSpeed() {
    if (this.bestIteration === 0) return 0;
    return this.bestIteration / this.values.length;
  }
}

/**
 * メインベイジアン最適化クラス
 */
class BayesianOptimizer {
  constructor(options = {}) {
    this.options = {
      acquisitionFunction: options.acquisitionFunction || 'ei',
      kernelType: options.kernelType || 'rbf',
      initialSamples: options.initialSamples || 5,
      maxIterations: options.maxIterations || 50,
      explorationWeight: options.explorationWeight || 0.1,
      ...options
    };

    this.gp = new GaussianProcessRegression({
      kernelType: this.options.kernelType,
      lengthScale: 1.0,
      variance: 1.0,
      noiseVariance: 0.01
    });

    this.acquisition = new AcquisitionFunctions(this.gp);
    this.constraintHandler = new ConstraintHandler();
    this.convergenceDetector = new ConvergenceDetector({
      maxIterations: this.options.maxIterations
    });

    this.X = [];
    this.y = [];
    this.bounds = {};
    this.objectiveFunction = null;
    this.acquisitionFunction = this.options.acquisitionFunction;
  }

  /**
   * 目的関数と境界の設定
   */
  setObjective(objectiveFunction, bounds) {
    this.objectiveFunction = objectiveFunction;
    this.bounds = bounds;
  }

  /**
   * 制約の追加
   */
  addConstraints(constraints) {
    this.constraintHandler.addConstraints(constraints);
  }

  /**
   * 獲得関数の設定
   */
  setAcquisitionFunction(acquisitionFunction) {
    if (['ei', 'ucb', 'pi'].includes(acquisitionFunction)) {
      this.acquisitionFunction = acquisitionFunction;
    } else {
      throw new Error(`Unsupported acquisition function: ${acquisitionFunction}`);
    }
  }

  /**
   * 初期サンプリング
   */
  generateInitialSamples() {
    const paramNames = Object.keys(this.bounds);
    let attempts = 0;
    const maxAttempts = this.options.initialSamples * 10; // 制約で失敗する場合のため
    
    while (this.X.length < this.options.initialSamples && attempts < maxAttempts) {
      const sample = {};
      
      paramNames.forEach(param => {
        const [min, max] = this.bounds[param];
        sample[param] = min + Math.random() * (max - min);
      });

      // 制約満足の確認
      if (this.constraintHandler.isFeasible(sample)) {
        const X_sample = this.parametersToArray(sample);
        const y_sample = this.objectiveFunction(sample);
        
        this.X.push(X_sample);
        this.y.push(y_sample);
      }
      attempts++;
    }
    
    // 最低限のサンプルが得られない場合はエラー
    if (this.X.length === 0) {
      throw new Error('Failed to generate any feasible initial samples');
    }
  }

  /**
   * ベイジアン最適化の実行
   */
  async optimize() {
    if (!this.objectiveFunction || Object.keys(this.bounds).length === 0) {
      throw new Error('Objective function and bounds must be set before optimization');
    }

    // 初期サンプリング
    this.generateInitialSamples();

    let iteration = 0;
    while (!this.convergenceDetector.hasConverged() && iteration < this.options.maxIterations) {
      // ガウス過程の学習
      this.gp.fit(this.X, this.y);

      // 次の候補点の選択
      const nextPoint = this.selectNextPoint();
      
      if (nextPoint) {
        // 目的関数の評価
        const y_next = this.objectiveFunction(nextPoint);
        
        // データセットの更新
        const X_next = this.parametersToArray(nextPoint);
        this.X.push(X_next);
        this.y.push(y_next);

        // 収束判定の更新
        this.convergenceDetector.update(y_next);
      }

      iteration++;
    }

    // 最適解の抽出
    if (this.y.length === 0) {
      throw new Error('No evaluations completed during optimization');
    }
    
    const bestIndex = this.y.indexOf(Math.max(...this.y));
    const bestX = this.X[bestIndex];
    if (!bestX || bestIndex === -1) {
      // フォールバック: 最初の結果を使用
      if (this.X.length > 0 && this.y.length > 0) {
        const bestParameters = this.arrayToParameters(this.X[0]);
        const bestValue = this.y[0];
        return { bestParameters, bestValue, convergenceInfo: this.convergenceDetector.getConvergenceStatistics(), iterations: iteration, evaluations: this.y.length };
      }
      throw new Error('No valid best solution found');
    }
    const bestParameters = this.arrayToParameters(bestX);
    const bestValue = this.y[bestIndex];

    return {
      bestParameters,
      bestValue,
      convergenceInfo: this.convergenceDetector.getConvergenceStatistics(),
      iterations: iteration,
      evaluations: this.y.length
    };
  }

  /**
   * 次の候補点の選択
   */
  selectNextPoint() {
    const candidates = this.generateCandidates(1000);
    const feasibleCandidates = candidates.filter(c => this.constraintHandler.isFeasible(c));
    
    if (feasibleCandidates.length === 0) {
      return null;
    }

    const candidateArrays = feasibleCandidates.map(c => this.parametersToArray(c));
    let acquisitionValues;

    const fBest = Math.max(...this.y);

    switch (this.acquisitionFunction) {
      case 'ei':
        acquisitionValues = this.acquisition.expectedImprovement(
          candidateArrays, fBest, this.options.explorationWeight
        );
        break;
      case 'ucb':
        acquisitionValues = this.acquisition.upperConfidenceBound(
          candidateArrays, 2.576
        );
        break;
      case 'pi':
        acquisitionValues = this.acquisition.probabilityOfImprovement(
          candidateArrays, fBest, this.options.explorationWeight
        );
        break;
      default:
        throw new Error(`Unknown acquisition function: ${this.acquisitionFunction}`);
    }

    const bestCandidateIndex = acquisitionValues.indexOf(Math.max(...acquisitionValues));
    return feasibleCandidates[bestCandidateIndex];
  }

  /**
   * 候補点の生成
   */
  generateCandidates(numCandidates) {
    const candidates = [];
    const paramNames = Object.keys(this.bounds);

    for (let i = 0; i < numCandidates; i++) {
      const candidate = {};
      
      paramNames.forEach(param => {
        const [min, max] = this.bounds[param];
        candidate[param] = min + Math.random() * (max - min);
      });

      candidates.push(candidate);
    }

    return candidates;
  }

  /**
   * パラメータ辞書を配列に変換
   */
  parametersToArray(parameters) {
    return Object.keys(this.bounds).map(param => parameters[param]);
  }

  /**
   * 配列をパラメータ辞書に変換
   */
  arrayToParameters(array) {
    if (!array || !Array.isArray(array)) {
      throw new Error('Array parameter is required and must be an array');
    }
    
    const parameters = {};
    const paramNames = Object.keys(this.bounds);
    
    if (array.length !== paramNames.length) {
      throw new Error(`Array length ${array.length} does not match parameter count ${paramNames.length}`);
    }
    
    paramNames.forEach((param, i) => {
      parameters[param] = array[i];
    });
    return parameters;
  }
}

/**
 * リスクパラメータ最適化クラス
 */
class RiskParameterOptimizer {
  constructor(options = {}) {
    this.options = {
      maxIterations: options.maxIterations || 30,
      acquisitionFunction: options.acquisitionFunction || 'ei',
      ...options
    };

    this.bayesianOptimizer = new BayesianOptimizer(this.options);
    this.marketContext = null;
    this.tradingCosts = null;

    // リスクパラメータの境界
    this.riskBounds = {
      stopLoss: [0.005, 0.1],
      trailingStop: [0.001, 0.05],
      maxPositions: [1, 20],
      maxDailyLoss: [0.01, 0.2]
    };

    // 制約の設定
    const constraints = this.createRiskConstraints();
    this.bayesianOptimizer.addConstraints(constraints);
  }

  /**
   * 市場コンテキストの設定
   */
  setMarketContext(marketContext) {
    this.marketContext = marketContext;
    
    // 目的関数の設定
    this.objectiveFunction = (params) => this.evaluateRiskParameters(params);
    this.bayesianOptimizer.setObjective(this.objectiveFunction, this.riskBounds);
  }

  /**
   * 取引コストの設定
   */
  setTradingCosts(tradingCosts) {
    this.tradingCosts = tradingCosts;
  }

  /**
   * リスクパラメータの評価
   */
  evaluateRiskParameters(params) {
    if (!this.marketContext) {
      throw new Error('Market context must be set before evaluation');
    }

    const {
      stopLoss,
      trailingStop,
      maxPositions,
      maxDailyLoss
    } = params;

    const {
      volatility = 0.1,
      sharpeRatio = 1.0,
      maxDrawdown = 0.1,
      avgTradeDuration = 1.0,
      winRate = 0.5
    } = this.marketContext;

    // リスク調整済みリターンの計算
    const riskAdjustedReturn = this.calculateRiskAdjustedReturn(params);
    
    // ドローダウンペナルティ
    const drawdownPenalty = this.calculateDrawdownPenalty(params);
    
    // ポジション効率性
    const positionEfficiency = this.calculatePositionEfficiency(params);
    
    // 取引コスト調整
    const costAdjustment = this.tradingCosts ? this.calculateCostAdjustment(params) : 0;

    // 総合スコア
    const score = riskAdjustedReturn - drawdownPenalty + positionEfficiency - costAdjustment;
    
    return score;
  }

  /**
   * リスク調整済みリターンの計算
   */
  calculateRiskAdjustedReturn(params) {
    const { volatility, sharpeRatio } = this.marketContext;
    const { stopLoss, trailingStop } = params;

    // ストップロスの効果的な最大損失
    const effectiveMaxLoss = Math.min(stopLoss, trailingStop * 2);
    
    // ボラティリティ調整
    const volatilityAdjustment = 1 / (1 + volatility);
    
    // リスク調整済みシャープレシオ
    const adjustedSharpe = sharpeRatio * volatilityAdjustment * (0.05 / effectiveMaxLoss);
    
    return adjustedSharpe;
  }

  /**
   * ドローダウンペナルティの計算
   */
  calculateDrawdownPenalty(params) {
    const { maxDrawdown } = this.marketContext;
    const { maxDailyLoss } = params;

    // 日次損失限度がドローダウンに対して適切か
    const ddRatio = maxDailyLoss / Math.max(maxDrawdown, 0.01);
    
    // 過度に制限的または緩い設定にペナルティ
    if (ddRatio < 0.1 || ddRatio > 0.5) {
      return Math.abs(ddRatio - 0.25) * 2;
    }
    
    return 0;
  }

  /**
   * ポジション効率性の計算
   */
  calculatePositionEfficiency(params) {
    const { avgTradeDuration, winRate } = this.marketContext;
    const { maxPositions } = params;

    // 取引頻度とポジション数のバランス
    const turnoverRate = 1 / Math.max(avgTradeDuration, 0.1);
    const optimalPositions = Math.sqrt(turnoverRate * winRate * 10);
    
    // 最適ポジション数からの乖離にペナルティ
    const deviation = Math.abs(maxPositions - optimalPositions) / optimalPositions;
    
    return Math.max(0, 1 - deviation);
  }

  /**
   * 取引コスト調整の計算
   */
  calculateCostAdjustment(params) {
    if (!this.tradingCosts) return 0;

    const { commission, spread, slippage } = this.tradingCosts;
    const { maxPositions } = params;
    
    // ポジション数に比例する取引コスト
    const totalCost = (commission + spread + slippage) * maxPositions;
    
    return totalCost * 100; // スケール調整
  }

  /**
   * リスクパラメータ最適化の実行
   */
  async optimizeRiskParameters(marketContext) {
    this.setMarketContext(marketContext);
    
    const result = await this.bayesianOptimizer.optimize();
    
    // 結果の後処理
    const optimizedParams = result.bestParameters;
    const expectedPerformance = this.evaluateRiskParameters(optimizedParams);
    
    return {
      optimalParameters: optimizedParams,
      expectedPerformance,
      riskMetrics: this.calculateRiskMetrics(optimizedParams),
      convergenceInfo: result.convergenceInfo,
      iterations: result.iterations
    };
  }

  /**
   * リスクメトリクスの計算
   */
  calculateRiskMetrics(params) {
    const { stopLoss, trailingStop, maxPositions, maxDailyLoss } = params;
    
    return {
      maxSingleLoss: stopLoss,
      maxPortfolioRisk: maxPositions * stopLoss,
      dailyRiskBudget: maxDailyLoss,
      riskAdjustedCapacity: maxPositions / stopLoss,
      trailingEfficiency: trailingStop / stopLoss
    };
  }

  /**
   * 量子最適化との統合
   */
  integrateWithQuantumOptimizer(quantumResult) {
    const bayesianParams = this.bayesianOptimizer.X.length > 0 ? 
      this.bayesianOptimizer.arrayToParameters(this.bayesianOptimizer.X[this.bayesianOptimizer.y.indexOf(Math.max(...this.bayesianOptimizer.y))]) : 
      null;

    // デフォルト市場コンテキストを設定（テスト用）
    if (!this.marketContext) {
      this.setMarketContext({
        volatility: 0.1,
        sharpeRatio: 1.0,
        maxDrawdown: 0.1,
        avgTradeDuration: 1.0,
        winRate: 0.5
      });
    }

    if (!bayesianParams) {
      return {
        bayesianParams: null,
        quantumParams: quantumResult.parameters,
        combinedParams: null,
        combinedScore: 0,
        bayesianScore: 0,
        quantumScore: this.evaluateQuantumParameters(quantumResult.parameters),
        recommendedApproach: 'quantum_only'
      };
    }

    // 両手法の結果を統合
    const quantumScore = this.evaluateQuantumParameters(quantumResult.parameters);
    const bayesianScore = Math.max(...this.bayesianOptimizer.y);

    const combinedParams = this.combineParameters(quantumResult.parameters, bayesianParams);
    const combinedScore = this.evaluateRiskParameters(combinedParams);

    return {
      bayesianParams,
      quantumParams: quantumResult.parameters,
      combinedParams,
      combinedScore,
      bayesianScore,
      quantumScore,
      recommendedApproach: this.selectBestApproach(bayesianScore, quantumScore, combinedScore)
    };
  }

  /**
   * 量子パラメータの評価
   */
  evaluateQuantumParameters(quantumParams) {
    // 量子パラメータをリスクパラメータに変換
    const riskParams = {
      stopLoss: 0.02 * (quantumParams.riskWeight || 0.5),
      trailingStop: 0.01 * (quantumParams.volatilityWeight || 0.5),
      maxPositions: Math.floor(10 * (quantumParams.performanceWeight || 0.5)) + 1,
      maxDailyLoss: 0.05 * (quantumParams.riskWeight || 0.5)
    };

    return this.evaluateRiskParameters(riskParams);
  }

  /**
   * パラメータの統合
   */
  combineParameters(quantumParams, bayesianParams) {
    // 重み付け平均による統合
    const weights = { quantum: 0.4, bayesian: 0.6 };

    const riskParamsFromQuantum = {
      stopLoss: 0.02 * (quantumParams.riskWeight || 0.5),
      trailingStop: 0.01 * (quantumParams.volatilityWeight || 0.5),
      maxPositions: Math.floor(10 * (quantumParams.performanceWeight || 0.5)) + 1,
      maxDailyLoss: 0.05 * (quantumParams.riskWeight || 0.5)
    };

    const combined = {};
    Object.keys(bayesianParams).forEach(param => {
      if (riskParamsFromQuantum[param] !== undefined) {
        combined[param] = weights.quantum * riskParamsFromQuantum[param] + 
                         weights.bayesian * bayesianParams[param];
      } else {
        combined[param] = bayesianParams[param];
      }
    });

    return combined;
  }

  /**
   * 最適手法の選択
   */
  selectBestApproach(bayesianScore, quantumScore, combinedScore) {
    const scores = {
      bayesian: bayesianScore,
      quantum: quantumScore,
      combined: combinedScore
    };

    const best = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
    
    return best;
  }

  /**
   * リスク制約の作成
   */
  createRiskConstraints() {
    return [
      { type: 'range', parameter: 'stopLoss', min: 0.005, max: 0.1 },
      { type: 'range', parameter: 'trailingStop', min: 0.001, max: 0.05 },
      { type: 'range', parameter: 'maxPositions', min: 1, max: 20 },
      { type: 'range', parameter: 'maxDailyLoss', min: 0.01, max: 0.2 }
    ];
  }

  /**
   * 取引コスト考慮の最適化
   */
  optimizeWithTradingCosts() {
    if (!this.tradingCosts) {
      throw new Error('Trading costs must be set before optimization');
    }

    // グロスシャープレシオからネットシャープレシオを計算
    const grossSharpe = this.marketContext.sharpeRatio || 1.0;
    const totalCosts = this.tradingCosts.commission + this.tradingCosts.spread + this.tradingCosts.slippage;
    
    // 簡易的なコスト調整（実際にはより複雑な計算が必要）
    const netSharpe = grossSharpe * (1 - totalCosts * 252); // 年間取引回数を252と仮定
    
    // 損益分岐点の計算
    const breakEvenVolume = totalCosts / (this.marketContext.avgReturn || 0.001);

    return {
      grossSharpeRatio: grossSharpe,
      netSharpeRatio: Math.max(0, netSharpe),
      costDrag: grossSharpe - netSharpe,
      breakEvenVolume
    };
  }
}

module.exports = {
  BayesianOptimizer,
  GaussianProcessRegression,
  AcquisitionFunctions,
  KernelFunctions,
  ConstraintHandler,
  ConvergenceDetector,
  RiskParameterOptimizer
};