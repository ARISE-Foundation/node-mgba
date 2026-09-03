import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import globals from 'globals';

export default [
    js.configs.recommended,
    ...pluginVue.configs['flat/recommended'],
    {
        files: ['src/**/*.ts', 'plugins/**/*.ts', 'tests/**/*.ts', 'gui/server.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: './tsconfig.json',
            },
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            ...tseslint.configs['recommended'].rules,
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ],
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/no-non-null-assertion': 'error',
            'no-console': 'off',
        },
    },
    {
        files: ['gui/src/**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                project: './gui/tsconfig.json',
            },
            globals: {
                ...globals.browser,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            ...tseslint.configs['recommended'].rules,
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ],
            'no-console': 'off',
        },
    },
    {
        files: ['gui/vite.config.ts'],
        languageOptions: {
            parser: tsparser,
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            ...tseslint.configs['recommended'].rules,
            'no-console': 'off',
        },
    },
    {
        files: ['gui/src/**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tsparser,
                extraFileExtensions: ['.vue'],
                sourceType: 'module',
            },
            globals: {
                ...globals.browser,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            ...tseslint.configs['recommended'].rules,
            'vue/multi-word-component-names': 'off',
            'vue/no-v-html': 'off',
            'vue/max-attributes-per-line': 'off',
            'vue/singleline-html-element-content-newline': 'off',
            'vue/html-self-closing': 'off',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ],
            'no-console': 'off',
        },
    },
    {
        ignores: ['dist/**', 'gui/dist/**', 'node_modules/**', 'vendor/**', 'native/**', '**/*.d.ts', '**/*.js'],
    },
];
