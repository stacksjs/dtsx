# Configuration

`dtsx` can be configured with the following options:

```typescript
// dts.config.ts (or dts.config.js)
import type { DtsGenerationConfig } from '@stacksjs/dtsx'

const config: DtsGenerationConfig = {
  /**
   * The current working directory for the operation.
   * @default process.cwd()
   * @type {string}
   * @example
   * cwd: './'
   */
  cwd: './',

  /**
   * The root directory of the source files.
   * @default './src'
   * @type {string}
   * @example
   * root: './src'
   */
  root: './src',

  /**
   * The entry points for generating the declaration files.
   * Supports glob patterns for flexible selection.
   * @default ['**/*.ts']
   * @type {string[]}
   * @example
   * entrypoints: ['**/*.ts']
   */
  entrypoints: ['**/*.ts'],

  /**
   * The output directory for the generated declaration files.
   * @default './dist'
   * @type {string}
   * @example
   * outdir: './dist'
   */
  outdir: './dist',

  /**
   * Whether to preserve comments in the generated files.
   * @default true
   * @type {boolean}
   * @example
   * keepComments: true
   */
  keepComments: true,

  /**
   * Whether to clean the output directory before generating new files.
   * @default true
   * @type {boolean}
   * @example
   * clean: true
   */
  clean: true,

  /**
   * Path to the TypeScript configuration file.
   * @default './tsconfig.json'
   * @type {string}
   * @example
   * tsconfigPath: './tsconfig.json'
   */
  tsconfigPath: './tsconfig.json',

  /**
   * Output structure: 'mirror' to mirror source folder structure, 'flat' for flat output.
   * @default 'mirror'
   * @type {'mirror' | 'flat'}
   * @example
   * outputStructure: 'mirror'
   */
  outputStructure: 'mirror',

  /**
   * Whether to print detailed logs to the console.
   * Can be a boolean or array of specific log types.
   * @default false
   * @type {boolean | string[]}
   * @example
   * verbose: true
   * // or
   * verbose: ['generation', 'processing']
   */
  verbose: false,
}

export default config
```

## Configuration File

The configuration can be provided in several ways:

### 1. Configuration File

Create a `dts.config.ts` (or `dts.config.js`) file in your project root:

```typescript
// dts.config.ts
import type { DtsGenerationConfig } from '@stacksjs/dtsx'

const config: DtsGenerationConfig = {
  root: './lib',
  outdir: './types',
  keepComments: true,
  clean: true,
  outputStructure: 'flat',
}

export default config
```

### 2. Programmatic Configuration

Pass options directly to the `generate` function:

```typescript
import { generate } from '@stacksjs/dtsx'

await generate({
  root: './src',
  outdir: './dist',
  keepComments: true,
  verbose: true,
})
```

### 3. CLI Options

Use command-line flags to override configuration:

```bash
dtsx generate --root ./lib --outdir ./types --keep-comments --verbose
```

## Configuration Options

### Core Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cwd` | `string` | `process.cwd()` | Current working directory |
| `root` | `string` | `'./src'` | Source root directory |
| `entrypoints` | `string[]` | `['**/*.ts']` | Entry point patterns |
| `outdir` | `string` | `'./dist'` | Output directory |

### Generation Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keepComments` | `boolean` | `true` | Preserve comments in output |
| `clean` | `boolean` | `true` | Clean output directory before generation |
| `outputStructure` | `'mirror' \| 'flat'` | `'mirror'` | Output directory structure |

### Build Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tsconfigPath` | `string` | `'./tsconfig.json'` | Path to TypeScript config |
| `verbose` | `boolean \| string[]` | `false` | Enable verbose logging |

## Advanced Configuration

### Entry Points

Entry points support glob patterns and can be customized for different project structures:

```typescript
// Single entry point
entrypoints: ['src/index.ts']

// Multiple specific files
entrypoints: ['src/index.ts', 'src/types.ts', 'src/utils.ts']

// Glob patterns
entrypoints: ['src/**/*.ts', '!src/**/*.test.ts']

// Complex patterns
entrypoints: [
  'src/components/**/*.ts',
  'src/utils/**/*.ts',
  'src/types.ts'
]
```

### Output Structure

Choose between mirroring source structure or flat output:

```typescript
// Mirror source structure (default)
outputStructure: 'mirror'
// src/components/Button.ts → dist/components/Button.d.ts
// src/utils/helpers.ts → dist/utils/helpers.d.ts

// Flat structure
outputStructure: 'flat'
// src/components/Button.ts → dist/Button.d.ts
// src/utils/helpers.ts → dist/helpers.d.ts
```

### Verbose Logging

Control logging output with granular options:

```typescript
// Enable all verbose logging
verbose: true

// Disable verbose logging
verbose: false

// Specific log types (future feature)
verbose: ['generation', 'processing', 'imports']
```

### Comment Preservation

Control how comments are handled in the generated declarations:

```typescript
// Preserve all comments (default)
keepComments: true

// Remove comments for smaller output
keepComments: false
```

When `keepComments` is enabled, the following comment types are preserved:
- JSDoc comments (`/** ... */`)
- Block comments (`/* ... */`)
- Single-line comments (`//`)
- Documentation tags (`@param`, `@returns`, `@example`, etc.)

## Environment Variables

Some options can be controlled via environment variables:

```bash
# Set verbose logging
DTSX_VERBOSE=true

# Set output directory
DTSX_OUTDIR=./types

# Set root directory
DTSX_ROOT=./lib
```

## TypeScript Configuration

Ensure your `tsconfig.json` has `isolatedDeclarations` enabled:

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true,
    "declaration": true,
    "emitDeclarationOnly": false
  }
}
```

This is required for dtsx to work properly with TypeScript's isolated declarations feature.
