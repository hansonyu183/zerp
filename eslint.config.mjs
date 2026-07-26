import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      parserOptions: {
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser,
      },
    },
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-undef': 'off',
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'always' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: '业务请求必须统一通过 src/api/client.ts。',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'vue/one-component-per-file': 'off',
      'vue/require-default-prop': 'off',
    },
  },
  {
    files: ['**/*.vue'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['src/api/client.ts'],
    rules: {
      'no-restricted-globals': 'off',
    },
  },
  {
    files: ['src/pages/wfl/intermediary-trade/vm.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 1600, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['src/pages/vou/shared/vm.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 1075, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['src/pages/bob/shared/config.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 1000, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['src/pages/bob/shared/vm.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 900, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['src/pages/wfl/intermediary-trade/api.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  eslintConfigPrettier,
)
