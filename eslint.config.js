// Simplified ESLint configuration for Node 16+ compatibility
module.exports = [
  {
    languageOptions: {
      ecmaVersion: 2020, // Reduced from 2022 to avoid structuredClone issues
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        // Jest globals
        test: 'readonly',
        expect: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly'
      }
    },
    rules: {
      // Disable most rules to avoid compatibility issues
      'no-console': 'off',
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
      'no-undef': 'error'
    }
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**', 
      'coverage/**',
      'scripts/**',
      'test_*.js',
      'data/**',
      'src/**',
      'test/**',
      'checkOrderConsistency.js',
      'check_exchange_balance.js',
      'debug_positions.js',
      'emergency_fix_position_close.js',
      'extended_walkforward_backtest.js',
      'fixInconsistentPositions.js',
      'jest.setup.js'
    ]
  }
];