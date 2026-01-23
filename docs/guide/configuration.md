---
title: Configuration
description: Configure dtsx for your project with dts.config.ts options.
---

# Configuration

dtsx can be configured using a `dts.config.ts` (or `dts.config.js`) file in your project root.

## Configuration File

Create a `dts.config.ts` file:

```ts
// dts.config.ts
import type { DtsGenerationOptions } from '@stacksjs/dtsx'

const config: DtsGenerationOptions = {
  // Base directory
  cwd: './',

  // Source root directory
  root: './src',

  // Entry point patterns
  entrypoints: ['**/*.ts'],

  // Output directory
  outdir: './dist',

  // Keep comments in output
  keepComments: true,

  // Clean output directory before generation
  clean: true,

  // Enable verbose logging
  verbose: true,

  // Performance options
  parallel: true,
  concurrency: 4,

  // Validation
  validate: true,

  // Show statistics
  stats: true,

  // Filtering
  exclude: ['**/*.test.ts', '**/__tests__/**'],

  // Import ordering
  importOrder: ['node:', 'bun', '@myorg/'],
}

export default config
```

## Configuration Options

### Basic Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cwd` | `string` | `process.cwd()` | Current working directory |
| `root` | `string` | `'./src'` | Source root directory |
| `entrypoints` | `string[]` | `['**/*.ts']` | Glob patterns for entry files |
| `outdir` | `string` | `'./dist'` | Output directory for .d.ts files |
| `keepComments` | `boolean` | `true` | Preserve comments in output |
| `clean` | `boolean` | `false` | Clean output directory before generation |
| `tsconfig` | `string` | `'tsconfig.json'` | Path to tsconfig.json |

### Performance Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `parallel` | `boolean` | `false` | Process files in parallel |
| `concurrency` | `number` | `4` | Number of concurrent workers |

### Output Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `verbose` | `boolean` | `false` | Enable verbose output |
| `logLevel` | `string` | `'info'` | Log level: debug, info, warn, error, silent |
| `stats` | `boolean` | `false` | Show generation statistics |
| `outputFormat` | `string` | `'text'` | Output format: text or json |
| `progress` | `boolean` | `false` | Show progress during generation |
| `diff` | `boolean` | `false` | Show diff of changes |

### Validation Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `validate` | `boolean` | `false` | Validate generated .d.ts files |
| `continueOnError` | `boolean` | `false` | Continue processing on errors |
| `dryRun` | `boolean` | `false` | Preview without writing files |

### Filtering Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `exclude` | `string[]` | `[]` | Glob patterns to exclude |
| `importOrder` | `string[]` | `[]` | Import order priority patterns |

## Programmatic Configuration

Pass options directly to the `generate` function:

```ts
import { generate } from '@stacksjs/dtsx'

const stats = await generate({
  cwd: './',
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  clean: true,
  verbose: true,
  parallel: true,
  concurrency: 8,
  stats: true,
  validate: true,
  exclude: ['**/*.test.ts', '**/__tests__/**'],
})

console.log(`Generated ${stats.filesGenerated} files`)
console.log(`Duration: ${stats.durationMs}ms`)
```

## Environment Variables

dtsx supports environment variables:

| Variable | Description |
|----------|-------------|
| `DTSX_VERBOSE` | Enable verbose output |
| `DTSX_PARALLEL` | Enable parallel processing |
| `DTSX_CONCURRENCY` | Set concurrency level |

## Example Configurations

### Minimal Configuration

```ts
// dts.config.ts
export default {
  root: './src',
  outdir: './dist',
}
```

### Production Build

```ts
// dts.config.ts
export default {
  root: './src',
  outdir: './dist',
  clean: true,
  parallel: true,
  concurrency: 8,
  validate: true,
  keepComments: false,
  exclude: ['**/*.test.ts', '**/*.spec.ts'],
}
```

### Monorepo Package

```ts
// dts.config.ts
export default {
  root: './packages/core/src',
  outdir: './packages/core/dist',
  entrypoints: ['index.ts', 'types.ts'],
  clean: true,
  importOrder: ['node:', '@myorg/'],
}
```

### Development with Watch

```ts
// dts.config.ts
export default {
  root: './src',
  outdir: './dist',
  verbose: true,
  stats: true,
  validate: true,
}
```

## TypeScript Configuration

Ensure your `tsconfig.json` is properly configured:

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true,
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "moduleResolution": "bundler",
    "target": "ESNext",
    "module": "ESNext"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

## Related

- [Getting Started](./getting-started.md) - Installation and setup
- [CLI Commands](./cli.md) - Command-line interface
- [Isolated Declarations](./isolated-declarations.md) - TypeScript feature
