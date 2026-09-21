export default [{
  ignores: ['node_modules/**'],
}, {
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'module',
    globals: Object.fromEntries(['process', 'Buffer', 'URL', 'structuredClone', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch'].map(name => [name, 'readonly'])) },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-constant-condition': 'error',
    'no-unreachable': 'error',
    'no-undef': 'error',
    'no-duplicate-imports': 'error',
    'eqeqeq': 'error',
    'no-var': 'error',
    'prefer-const': 'error'
  }
}];
