import { defineConfig, globalIgnores } from 'eslint/config';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  globalIgnores(['dist/**/*', 'node_modules/**/*', 'prod/**/*']),

  // Configuration for TypeScript source files
  {
    files: ['**/*.ts'],
    extends: compat.extends(
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:prettier/recommended',
    ),

    plugins: {
      '@typescript-eslint': typescriptEslint,
    },

    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },

      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',

      parserOptions: {
        project: './tsconfig.json',
      },
    },

    rules: {
      '@typescript-eslint/no-explicit-any': 'off',

      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
        },
      ],

      // Prohibit direct fs imports - use utils/fs wrappers instead
      'no-restricted-imports': [
        'error',
        {
          name: 'fs',
          message:
            'Direct imports of "fs" are not allowed. Use "utils/fs" wrappers instead for consistent error handling.',
          allowTypeImports: true,
        },
      ],

      // Warn against path.join - prefer safePath from utils/fs for user-controlled paths
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.object.name='path'][callee.property.name='join']",
          message:
            'Avoid path.join with user input. Use safePath from utils/fs to prevent path traversal vulnerabilities.',
        },
      ],

      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto',
        },
      ],
    },
  },

  // Configuration for JavaScript config files (without TS parser)
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: compat.extends('eslint:recommended', 'plugin:prettier/recommended'),

    languageOptions: {
      globals: {
        ...globals.node,
      },

      ecmaVersion: 'latest',
      sourceType: 'module',
    },

    rules: {
      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto',
        },
      ],
    },
  },

  // Allow fs imports in the wrapper module itself and setup scripts
  {
    files: ['utils/fs.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },
]);
