import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'coverage'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // The one architectural rule, enforced mechanically: `src/sim/` is pure and
    // headless. No DOM, no wall clock, no platform RNG, no crypto, no imports
    // from `ui/` or `render/`. `tests/purity.spec.ts` greps the same tokens as a
    // backstop for when this config drifts.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/sim/ is headless — no DOM/BOM.' },
        { name: 'document', message: 'src/sim/ is headless — no DOM.' },
        { name: 'navigator', message: 'src/sim/ is headless — no navigator.' },
        { name: 'location', message: 'src/sim/ is headless — no location.' },
        { name: 'history', message: 'src/sim/ is headless — no history.' },
        { name: 'localStorage', message: 'src/sim/ is headless — no storage.' },
        { name: 'sessionStorage', message: 'src/sim/ is headless — no storage.' },
        { name: 'indexedDB', message: 'src/sim/ is headless — no storage.' },
        { name: 'fetch', message: 'src/sim/ is pure — no I/O.' },
        { name: 'XMLHttpRequest', message: 'src/sim/ is pure — no I/O.' },
        {
          name: 'Date',
          message: 'src/sim/ must be deterministic — no wall clock. Take time as an explicit input.',
        },
        { name: 'performance', message: 'src/sim/ must be deterministic — no performance.now().' },
        { name: 'crypto', message: 'src/sim/ must be deterministic — no crypto. Use RngStream.' },
        { name: 'requestAnimationFrame', message: 'src/sim/ is headless — no rAF.' },
        { name: 'requestIdleCallback', message: 'src/sim/ is headless — no rIC.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'src/sim/ must be deterministic — use RngStream.' },
        { object: 'Date', property: 'now', message: 'src/sim/ must be deterministic — no wall clock.' },
        { object: 'globalThis', property: 'crypto', message: 'src/sim/ must be deterministic.' },
        { object: 'window', property: 'crypto', message: 'src/sim/ must be deterministic.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'src/sim/ must be deterministic — no `new Date()`.' },
        { selector: "MemberExpression[object.name='Date']", message: 'src/sim/ must be deterministic — no `Date.*`.' },
        { selector: "MemberExpression[object.name='performance']", message: 'src/sim/ — no `performance.*`.' },
        { selector: "MemberExpression[object.name='crypto']", message: 'src/sim/ — no `crypto.*`.' },
        { selector: "Identifier[name='requestAnimationFrame']", message: 'src/sim/ is headless.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/ui/**', '**/ui', '**/render/**', '**/render'],
              message: 'src/sim/ must not import from ui/ or render/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', '*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
