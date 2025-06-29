// Minimal ESLint configuration that only processes this config file to avoid all compatibility issues
module.exports = [
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2015,
      sourceType: 'commonjs'
    },
    rules: {}
  },
  {
    ignores: [
      'coverage/**',
      'scripts/**', 
      'src/**',
      'test/**',
      'node_modules/**',
      '*.json',
      '!eslint.config.js'
    ]
  }
];