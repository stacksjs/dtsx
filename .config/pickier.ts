import type { PickierConfig } from 'pickier'

const config: PickierConfig = {
  verbose: false,
  ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.test-cli/**', '**/test/fixtures/**', '**/profiler.ts', '**/profiler-deep.ts', 'CHANGELOG.md'],

  lint: {
    extensions: ['ts', 'js', 'md'],
    reporter: 'stylish',
    cache: false,
    maxWarnings: 2,
  },

  format: {
    extensions: ['ts', 'js', 'json', 'md', 'yaml', 'yml'],
    trimTrailingWhitespace: true,
    maxConsecutiveBlankLines: 1,
    finalNewline: 'one',
    indent: 2,
    indentStyle: 'spaces',
    quotes: 'single',
    semi: false,
  },

  rules: {
    noDebugger: 'error',
    noConsole: 'off',
  },

  pluginRules: {
    'ts/no-top-level-await': 'off',
    'style/brace-style': 'off',
    'style/max-statements-per-line': 'off',
    'regexp/no-unused-capturing-group': 'off',
    'regexp/no-super-linear-backtracking': 'off',
    'style/quotes': 'off',
    'quality/quotes': 'off',
    // false positive: splits on raw `|` and counts pipes inside `\|` escapes
    // and inline code spans as column separators. Tables with TS union types
    // (e.g. `'build' \| 'watch'`) are flagged with mismatched column counts.
    'markdown/table-column-count': 'off',
  },
}

export default config
