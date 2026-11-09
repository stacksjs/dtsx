# @dtsx/vite

A Vite plugin for automatic TypeScript declaration file generation using dtsx.

## Installation

```bash
bun add @dtsx/vite -d
# or
npm install @dtsx/vite --save-dev
```

## Usage

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { dts } from '@dtsx/vite'

export default defineConfig({
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
| `trigger` | `'build' \| 'serve' \| 'both'` | `'build'` | When to generate declarations |
| `timing` | `'before' \| 'after'` | `'before'` | Generate before Vite writes the bundle (after it empties `outDir`) or after the build |
| `root` | `string` | folder of `build.lib.entry`, else `./src` | Source root; declarations mirror the source from here |
| `outdir` | `string` | Vite `build.outDir` | Output directory for declarations |
| `entryPointsOnly` | `boolean` | `true` | Only generate for entry points |
| `declarationDir` | `string` | Vite outDir | Output directory for declarations |
| `bundle` | `boolean` | `false` | Bundle all declarations into one file |
| `bundleOutput` | `string` | `'index.d.ts'` | Bundled output filename |
| `exclude` | `(string \| RegExp)[]` | `[]` | Patterns to exclude |
| `include` | `(string \| RegExp)[]` | `[]` | Patterns to include |
| `emitOnError` | `boolean` | `true` | Emit even with type errors |

## Examples

### Basic Usage

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { dts } from '@dtsx/vite'

export default defineConfig({
  plugins: [dts()],
})
```

### With Bundled Declarations

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { dts } from '@dtsx/vite'

export default defineConfig({
  plugins: [
    dts({
      bundle: true,
      bundleOutput: 'types.d.ts',
    }),
  ],
})
```

### Library Mode

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { dts } from '@dtsx/vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
    },
  },
  plugins: [
    dts({
      entryPointsOnly: true,
    }),
  ],
})
```

### With Callbacks

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { dts } from '@dtsx/vite'

export default defineConfig({
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
// vite.config.ts
import { defineConfig } from 'vite'
import { dts } from '@dtsx/vite'

export default defineConfig({
  plugins: [
    dts({
      include: [/src\/lib/],
      exclude: ['test', /\.spec\.ts$/],
    }),
  ],
})
```

### Dev Server Mode

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { dts } from '@dtsx/vite'

export default defineConfig({
  plugins: [
    dts({
      trigger: 'both', // Generate on both build and dev server start
    }),
  ],
})
```

## License

MIT
