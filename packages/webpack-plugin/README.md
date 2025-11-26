# webpack-plugin-dtsx

A webpack plugin for automatic TypeScript declaration file generation using dtsx.

## Installation

```bash
bun add webpack-plugin-dtsx -d
# or
npm install webpack-plugin-dtsx --save-dev
```

## Usage

```javascript
// webpack.config.js
const { DtsxWebpackPlugin } = require('webpack-plugin-dtsx')

module.exports = {
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
  },
  plugins: [
    new DtsxWebpackPlugin({
      // Options
    }),
  ],
}
```

### ESM Usage

```javascript
// webpack.config.mjs
import { DtsxWebpackPlugin } from 'webpack-plugin-dtsx'

export default {
  entry: './src/index.ts',
  output: {
    path: new URL('./dist', import.meta.url).pathname,
    filename: 'bundle.js',
  },
  plugins: [
    new DtsxWebpackPlugin(),
  ],
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trigger` | `'emit' \| 'afterEmit' \| 'done'` | `'afterEmit'` | When to generate declarations |
| `entryPointsOnly` | `boolean` | `true` | Only generate for entry points |
| `declarationDir` | `string` | webpack output path | Output directory for declarations |
| `bundle` | `boolean` | `false` | Bundle all declarations into one file |
| `bundleOutput` | `string` | `'index.d.ts'` | Bundled output filename |
| `exclude` | `(string \| RegExp)[]` | `[]` | Patterns to exclude |
| `include` | `(string \| RegExp)[]` | `[]` | Patterns to include |
| `emitOnError` | `boolean` | `false` | Emit even with compilation errors |
| `skipUnchanged` | `boolean` | `true` | Skip if no TS files changed (watch mode) |

## Examples

### Basic Usage

```javascript
const { DtsxWebpackPlugin } = require('webpack-plugin-dtsx')

module.exports = {
  // ...
  plugins: [
    new DtsxWebpackPlugin(),
  ],
}
```

### With Bundled Declarations

```javascript
const { DtsxWebpackPlugin } = require('webpack-plugin-dtsx')

module.exports = {
  // ...
  plugins: [
    new DtsxWebpackPlugin({
      bundle: true,
      bundleOutput: 'types.d.ts',
    }),
  ],
}
```

### Custom Output Directory

```javascript
const { DtsxWebpackPlugin } = require('webpack-plugin-dtsx')

module.exports = {
  // ...
  plugins: [
    new DtsxWebpackPlugin({
      declarationDir: 'types', // Outputs to dist/types/
    }),
  ],
}
```

### Generate on Different Phases

```javascript
const { DtsxWebpackPlugin } = require('webpack-plugin-dtsx')

module.exports = {
  // ...
  plugins: [
    new DtsxWebpackPlugin({
      // 'emit' - During asset emission
      // 'afterEmit' - After assets are written (default)
      // 'done' - When compilation is complete
      trigger: 'done',
    }),
  ],
}
```

### With Callbacks

```javascript
const { DtsxWebpackPlugin } = require('webpack-plugin-dtsx')

module.exports = {
  // ...
  plugins: [
    new DtsxWebpackPlugin({
      onStart: () => {
        console.log('Starting declaration generation...')
      },
      onSuccess: (stats) => {
        console.log(`Generated ${stats.totalFiles} files in ${stats.totalTime}ms`)
      },
      onError: (error) => {
        console.error('Failed to generate declarations:', error.message)
      },
    }),
  ],
}
```

### Filter Files

```javascript
const { DtsxWebpackPlugin } = require('webpack-plugin-dtsx')

module.exports = {
  // ...
  plugins: [
    new DtsxWebpackPlugin({
      include: [/src\/lib/],
      exclude: ['test', /\.spec\.ts$/],
    }),
  ],
}
```

### Process All TypeScript Files

```javascript
const { DtsxWebpackPlugin } = require('webpack-plugin-dtsx')

module.exports = {
  // ...
  plugins: [
    new DtsxWebpackPlugin({
      entryPointsOnly: false, // Process all TS files in compilation
    }),
  ],
}
```

## Additional Plugins

### Type Checking Only

```javascript
const { dtsxCheck } = require('webpack-plugin-dtsx')

module.exports = {
  plugins: [dtsxCheck()],
}
```

### Watch for Declaration Changes

```javascript
const { dtsxWatch } = require('webpack-plugin-dtsx')

module.exports = {
  plugins: [
    dtsxWatch({
      onDeclarationChange: (file) => {
        console.log(`Declaration changed: ${file}`)
      },
    }),
  ],
}
```

## Factory Function

You can also use the factory function:

```javascript
const { dtsx } = require('webpack-plugin-dtsx')

module.exports = {
  plugins: [
    dtsx({
      bundle: true,
    }),
  ],
}
```

## Webpack 4 vs 5

This plugin supports both webpack 4 and webpack 5. The API is the same for both versions.

## TypeScript Configuration

The plugin automatically detects your `tsconfig.json`. You can also specify a custom path:

```javascript
new DtsxWebpackPlugin({
  tsconfigPath: './tsconfig.build.json',
})
```

## Performance Tips

1. **Use `entryPointsOnly: true`** (default) for faster builds
2. **Enable `skipUnchanged`** (default) in watch mode
3. **Use `trigger: 'done'`** if you don't need declarations during emit

## License

MIT
