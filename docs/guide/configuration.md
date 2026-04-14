---
title: Configuration
description: Configure dtsx for your project with dts.config.ts options.
---
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
  exclude: ['**/*.test.ts', '**/**tests**/**'],
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
