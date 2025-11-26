# esbuild-plugin-dtsx

An esbuild plugin for automatic TypeScript declaration file generation using dtsx.

## Installation

```bash
bun add esbuild-plugin-dtsx -d
# or
npm install esbuild-plugin-dtsx --save-dev
```

## Usage

```typescript
import { build } from 'esbuild'
import { dtsx } from 'esbuild-plugin-dtsx'

await build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  plugins: [
    dtsx({
      // Options
    }),
  ],
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trigger` | `'build' \| 'watch' \| 'both'` | `'build'` | When to generate declarations |
| `entryPointsOnly` | `boolean` | `true` | Only generate for entry points |
| `declarationDir` | `string` | esbuild outdir | Output directory for declarations |
| `bundle` | `boolean` | `false` | Bundle all declarations into one file |
| `bundleOutput` | `string` | `'index.d.ts'` | Bundled output filename |
| `exclude` | `(string \| RegExp)[]` | `[]` | Patterns to exclude |
| `include` | `(string \| RegExp)[]` | `[]` | Patterns to include |
| `emitOnError` | `boolean` | `true` | Emit even with type errors |

## Examples

### Basic Usage

```typescript
import { build } from 'esbuild'
import { dtsx } from 'esbuild-plugin-dtsx'

await build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [dtsx()],
})
```

### With Bundled Declarations

```typescript
import { build } from 'esbuild'
import { dtsx } from 'esbuild-plugin-dtsx'

await build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [
    dtsx({
      bundle: true,
      bundleOutput: 'types.d.ts',
    }),
  ],
})
```

### Watch Mode

```typescript
import { context } from 'esbuild'
import { dtsx } from 'esbuild-plugin-dtsx'

const ctx = await context({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [
    dtsx({
      trigger: 'both', // Generate on initial build and rebuilds
    }),
  ],
})

await ctx.watch()
```

### With Callbacks

```typescript
import { build } from 'esbuild'
import { dtsx } from 'esbuild-plugin-dtsx'

await build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [
    dtsx({
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
})
```

## Additional Plugins

### Type Checking Only

```typescript
import { dtsxCheck } from 'esbuild-plugin-dtsx'

await build({
  plugins: [dtsxCheck()],
})
```

### Watch for Declaration Changes

```typescript
import { dtsxWatch } from 'esbuild-plugin-dtsx'

await build({
  plugins: [
    dtsxWatch({
      onDeclarationChange: (file) => {
        console.log(`Declaration changed: ${file}`)
      },
    }),
  ],
})
```

## License

MIT
