# bun-plugin-dtsx

A Bun Bundler plugin for automatic TypeScript declaration file generation using dtsx.

## Installation

```bash
bun add bun-plugin-dtsx -d
# or
npm install bun-plugin-dtsx --save-dev
```

## Usage

```typescript
// build.ts
import { dts } from 'bun-plugin-dtsx'

await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [
    dts({
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
| `declarationDir` | `string` | Bun outdir | Output directory for declarations |
| `bundle` | `boolean` | `false` | Bundle all declarations into one file |
| `bundleOutput` | `string` | `'index.d.ts'` | Bundled output filename |
| `exclude` | `(string \| RegExp)[]` | `[]` | Patterns to exclude |
| `include` | `(string \| RegExp)[]` | `[]` | Patterns to include |
| `emitOnError` | `boolean` | `true` | Emit even with type errors |

## Examples

### Basic Usage

```typescript
import { dts } from 'bun-plugin-dtsx'

await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [dts()],
})
```

### With Bundled Declarations

```typescript
import { dts } from 'bun-plugin-dtsx'

await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [
    dts({
      bundle: true,
      bundleOutput: 'types.d.ts',
    }),
  ],
})
```

### Multiple Entry Points

```typescript
import { dts } from 'bun-plugin-dtsx'

await Bun.build({
  entrypoints: ['src/index.ts', 'src/utils.ts'],
  outdir: 'dist',
  plugins: [
    dts({
      entryPointsOnly: true,
    }),
  ],
})
```

### With Callbacks

```typescript
import { dts } from 'bun-plugin-dtsx'

await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [
    dts({
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

### Filter Files

```typescript
import { dts } from 'bun-plugin-dtsx'

await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [
    dts({
      include: [/src\/lib/],
      exclude: ['test', /\.spec\.ts$/],
    }),
  ],
})
```

### Custom Output Directory

```typescript
import { dts } from 'bun-plugin-dtsx'

await Bun.build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  plugins: [
    dts({
      declarationDir: 'types',
    }),
  ],
})
```

## License

MIT
