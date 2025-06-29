import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
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
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly'
      }
    },
    rules: {
      // Allow console.log for this type of project
      'no-console': 'off',
      
      // Allow unused vars with underscore prefix
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
      
      // Prefer const/let over var
      'prefer-const': 'error',
      'no-var': 'error',
      
      // Basic code quality rules
      'no-undef': 'error',
      'no-unreachable': 'error',
      
      // Style preferences (warnings, not errors)
      'semi': ['warn', 'always'],
      'quotes': ['warn', 'single', { 'allowTemplateLiterals': true }],
      'indent': 'off' // Project has inconsistent indentation, disable for now
    }
  },
  {
    files: ['test/**/*.js', '**/*.test.js', '__mocks__/**/*.js'],
    languageOptions: {
      globals: {
        test: 'readonly',
        expect: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
        performance: 'readonly'
      }
    }
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**'
    ]
  }
];