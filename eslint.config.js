import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const browserGlobals = {
  window: 'readonly', document: 'readonly', location: 'readonly',
  localStorage: 'readonly', navigator: 'readonly', fetch: 'readonly',
  history: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly', confirm: 'readonly',
  URLSearchParams: 'readonly', Response: 'readonly',
  google: 'readonly', gapi: 'readonly',
};

export default [
  js.configs.recommended,
  {
    files: ['server/**/*.js', 'web/src/**/*.{js,jsx}', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'], // allow == null for null-or-undefined checks
      'no-console': 'off',
    },
  },
  {
    // Worker runtime + WebCrypto + fetch globals
    files: ['server/**/*.js'],
    languageOptions: {
      globals: {
        crypto: 'readonly', fetch: 'readonly', Response: 'readonly',
        Request: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly',
        btoa: 'readonly', atob: 'readonly', console: 'readonly',
      },
    },
  },
  {
    // React client (JSX, browser globals, automatic JSX runtime)
    files: ['web/src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/jsx-uses-vars': 'error',   // mark JSX-referenced imports as used
      'react/jsx-uses-react': 'off',    // automatic runtime — no React import needed
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    // Test + Node tooling globals
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        crypto: 'readonly', fetch: 'readonly', Response: 'readonly',
        URL: 'readonly', Buffer: 'readonly', TextEncoder: 'readonly',
        TextDecoder: 'readonly', btoa: 'readonly', atob: 'readonly',
        globalThis: 'readonly', Date: 'readonly',
      },
    },
  },
];
