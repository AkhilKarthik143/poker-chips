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
}, {
  files: ['public/**/*.js'],
  languageOptions: { globals: Object.fromEntries([
    'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'matchMedia', 'ResizeObserver',
    'IntersectionObserver', 'crypto', 'requestAnimationFrame', 'cancelAnimationFrame', 'CSS', 'Event',
    'CustomEvent', 'HTMLElement', 'AudioContext', 'visualViewport', 'performance', 'Notification', 'location'
  ].map(name => [name, 'readonly'])) }
}, {
  files: ['public/sw.js'],
  languageOptions: { globals: Object.fromEntries([
    'self', 'caches', 'clients', 'registration', 'skipWaiting', 'importScripts', 'Request', 'Response',
    'Headers', 'Notification', 'PushEvent', 'FetchEvent', 'ExtendableEvent', 'ServiceWorkerGlobalScope', 'location'
  ].map(name => [name, 'readonly'])) }
}];
