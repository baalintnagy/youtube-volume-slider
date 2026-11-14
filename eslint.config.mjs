import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['node_modules/', 'dist/'] },
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'test/e2e/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: { ...globals.browser, chrome: 'readonly', module: 'writable' },
        },
    },
    {
        files: ['test/*.test.js'],
        languageOptions: { sourceType: 'commonjs', globals: globals.node },
    },
    {
        files: ['**/*.mjs'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    {
        rules: {
            eqeqeq: 'error',
            curly: ['error', 'all'],
            'prefer-const': 'error',
            'no-var': 'error',
            'prefer-template': 'error',
            'no-implicit-coercion': 'error',
        },
    },
];
