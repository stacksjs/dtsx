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
dtsx generate --module-specifier-mode node
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
| `clean` | `boolean` | `true` | Remove stale managed declarations while preserving runtime files |
| `outputStructure` | `'mirror' \| 'flat'` | `'mirror'` | Output directory structure |
| `moduleSpecifierMode` | `'preserve' \| 'node'` | `'preserve'` | Keep existing spelling or use explicit runtime extensions from resolved targets |

With `moduleSpecifierMode: 'node'`, `processFile()` maps local authored `.d.ts`,
`.d.mts` and `.d.cts` targets to `.js`, `.mjs` and `.cjs` specifiers using the
configured output structure. This single-file transform does not deliver those
dependencies. `generate()` refuses an importer whose local authored declaration
is not delivered by the package build, instead of writing a dangling declaration
graph. This option does not add copying or emission of authored declaration
files. The default `preserve` mode retains existing behavior.

The `generate` CLI accepts `--module-specifier-mode preserve|node`; an explicit
flag overrides the project configuration. Both Bun build adapters select `node`
for `target: 'node'` and `preserve` for other targets. An explicit
`moduleSpecifierMode` overrides that target default. ESM format alone does not
select Node mode. Incremental cache identity includes the effective mode.
The Bun adapter uses the core declaration cache directly. `cacheDir` is relative
to the project `cwd` and defaults to `.dtsx-cache`. `clearCache(cacheDir)` from
`bun-plugin-dtsx` clears its manifest and preserves unrelated directory contents.
Its standalone `clearCache` resolves a relative path against the calling process's
working directory. When building with a different project `cwd`, pass the absolute
cache directory to `clearCache`.

Local module augmentations participate in the project graph. Imports needed to
activate those augmentations remain in declarations, with unused bindings
converted to bare imports. Required providers must be included in the build.
Incremental builds also track changes to this activation graph.

### Native Project Generation

Use the Bun API with an actual `zig-dtsx` executable supporting project protocol
v1 to plan sources, emit a native batch, and publish the declarations together:

```ts
import { generateNativeDeclarationProject } from '@stacksjs/dtsx'

const result = await generateNativeDeclarationProject('/path/to/zig-dtsx', {
  root: './src',
  outdir: './dist',
  entrypoints: ['index.ts'],
  moduleSpecifierMode: 'node',
}, { timeoutMs: 30_000 })

console.log(result.outputFiles)
```

The planner supplies source snapshots, hashes, resolved output paths and module
augmentation imports. The native emitter checks the batch and its retained local
references. A failed native batch leaves the prior declarations intact. Successful
publication uses the same staging and rollback owner as `generate()` and preserves
unrelated runtime files. A missing or incompatible executable fails the request;
there is no JavaScript emission fallback.

The supported options are `cwd`, `root`, `outdir`, `entrypoints`, `include`,
`exclude`, `autoIncludeReExports`, `outputStructure`, `tsconfigPath`,
`moduleSpecifierMode`, `keepComments`, `isolatedDeclarations`, `clean` and
`lineEnding`. Execution accepts an `AbortSignal` and a batch deadline (30 seconds
by default). Unsupported transformations are rejected before publication.

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

* JSDoc comments (`/** ... */`)
* Block comments (`/* ... */`)
* Single-line comments (`//`)
* Documentation tags (`@param`, `@returns`, `@example`, etc.)

## Environment Variables

Some options can be controlled via environment variables:

```bash
# Set verbose logging
DTSX*VERBOSE=true

# Set output directory
DTSX*OUTDIR=./types

# Set root directory
DTSX_ROOT=./lib
```

## TypeScript Configuration

You can optionally enable `isolatedDeclarations` in your `tsconfig.json` for a performance fast path. dtsx works great without it — it infers narrow types directly from values:

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true, // optional fast path
    "declaration": true,
    "emitDeclarationOnly": false
  }
}
```
