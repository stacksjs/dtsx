# tsup-plugin-dtsx

A tsup plugin for automatic TypeScript declaration file generation using dtsx.

## Installation

```bash
bun add tsup-plugin-dtsx -d
# or
npm install tsup-plugin-dtsx --save-dev
```

## Usage

### Basic Usage

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'
import { dtsxPlugin } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false, // Disable tsup's dts, use dtsx instead
  plugins: [
    dtsxPlugin(),
  ],
})
```

### Using the Helper

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dtsx: {
    // dtsx options
    bundle: true,
  },
})
```

### Quick Config

```typescript
// tsup.config.ts
import { createTsupConfig } from 'tsup-plugin-dtsx'

export default createTsupConfig('src/index.ts', {
  bundle: true,
  bundleOutput: 'types.d.ts',
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trigger` | `'buildStart' \| 'buildEnd'` | `'buildEnd'` | When to generate declarations |
| `entryPointsOnly` | `boolean` | `true` | Only generate for entry points |
| `declarationDir` | `string` | tsup outDir | Output directory for declarations |
| `bundle` | `boolean` | `false` | Bundle all declarations into one file |
| `bundleOutput` | `string` | `'index.d.ts'` | Bundled output filename |
| `exclude` | `(string \| RegExp)[]` | `[]` | Patterns to exclude |
| `include` | `(string \| RegExp)[]` | `[]` | Patterns to include |
| `skipIfTsupDts` | `boolean` | `true` | Skip if tsup dts is enabled |

## Examples

### With Bundled Declarations

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'
import { dtsxPlugin } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  plugins: [
    dtsxPlugin({
      bundle: true,
      bundleOutput: 'types.d.ts',
    }),
  ],
})
```

### Multiple Entry Points

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'
import { dtsxPlugin } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    utils: 'src/utils.ts',
    types: 'src/types.ts',
  },
  format: ['esm', 'cjs'],
  dts: false,
  plugins: [
    dtsxPlugin({
      entryPointsOnly: true,
    }),
  ],
})
```

### With Callbacks

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'
import { dtsxPlugin } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  plugins: [
    dtsxPlugin({
      onStart: () => {
        console.log('Starting declaration generation...')
      },
      onSuccess: (stats) => {
        console.log(`Generated ${stats.totalFiles} files in ${stats.totalTime}ms`)
      },
      onError: (error) => {
        console.error('Failed:', error.message)
      },
    }),
  ],
})
```

### Generate Before Build

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'
import { dtsxPlugin } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  plugins: [
    dtsxPlugin({
      trigger: 'buildStart', // Generate before build
    }),
  ],
})
```

### Filter Files

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'
import { dtsxPlugin } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  plugins: [
    dtsxPlugin({
      include: [/src\/lib/],
      exclude: ['test', /\.spec\.ts$/],
    }),
  ],
})
```

### Custom Output Directory

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'
import { dtsxPlugin } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  dts: false,
  plugins: [
    dtsxPlugin({
      declarationDir: 'types', // Outputs to types/ instead of dist/
    }),
  ],
})
```

## Why Use dtsx Instead of tsup's Built-in dts?

1. **Faster**: dtsx is optimized for speed and can be significantly faster for large projects
2. **More Options**: Bundling, filtering, callbacks, and more
3. **Better Control**: Fine-grained control over declaration generation
4. **Incremental Support**: Only regenerate changed files

## Compatibility

- tsup 6.x, 7.x, 8.x
- Node.js 18+
- Bun 1.0+

## TypeScript Configuration

The plugin automatically detects your `tsconfig.json`. You can also specify a custom path:

```typescript
dtsxPlugin({
  tsconfigPath: './tsconfig.build.json',
})
```

## License

MIT
