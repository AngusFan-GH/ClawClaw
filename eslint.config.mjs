import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'dist-backend/**', 'release/**', 'build/**', 'src-tauri/runtime/**', 'src-tauri/target/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // TypeScript handles these checks natively, disable ESLint duplicates
      'no-undef': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-alert': 'error',
      'no-restricted-globals': ['error', 'confirm', 'alert'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.type='Identifier'][callee.name='fetch']",
          message: 'Renderer code must not make HTTP calls; route through a ClawCore IPC channel.',
        },
        {
          selector: "NewExpression[callee.type='Identifier'][callee.name='WebSocket']",
          message: 'WebSocket is not allowed in the renderer; use the ClawCore event/IPC layer.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/lib/host-api', '**/stores/gateway', '**/lib/api-client'], message: 'Legacy gateway/host-api imports are removed; use lib/api.' },
            { group: ['@tauri-apps/api/core'], message: 'Only src/lib/desktop.ts may import the Tauri bridge.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/lib/desktop.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
];
