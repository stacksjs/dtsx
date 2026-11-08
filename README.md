<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version](https://img.shields.io/npm/v/@stacksjs/dtsx?style=flat-square)](https://npmjs.com/package/@stacksjs/dtsx)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/stacksjs/dtsx/ci.yml?style=flat-square&branch=main)](https://github.com/stacksjs/dtsx/actions?query=workflow%3Aci)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# dtsx

> Extremely fast, smart `.d.ts` generation with sound type inference & `@defaultValue` preservation.

## Features

- 🎯 Sound type inference with `@defaultValue` preservation
- ⚡ Extremely fast `.d.ts` generation
- 🤖 Cross-platform binary _(Zig native + Bun)_
- 🔄 Parallel processing support
- 📥 Stdin/stdout support for piping
- 👀 Watch mode for development
- ⚙️ Highly configurable
- ✅ Built-in validation
- 🔌 tsdown integration with ESM, CommonJS and watch support
- 📦 Bundled API and CLI with no required npm dependencies

> [!NOTE]
> dtsx works out of the box without `isolatedDeclarations` — it infers narrow types directly from your source values. That said, enabling `isolatedDeclarations` is still a good idea as it enforces explicit type annotations at module boundaries, encouraging better type hygiene across your codebase. When enabled, dtsx treats annotations as authoritative, skips initializers for concrete types, and only reads broad containers to preserve `@defaultValue` documentation.

## Install

```bash
bun install -d @stacksjs/dtsx
```

> _@npmjs.com, please allow us to use the `dtsx` package name 🙏_

<!-- _Alternatively, you can install:_

```bash
brew install dtsx # wip
pkgx install dtsx # wip
``` -->

## Usage

There are two ways to use dtsx: _as a library or as a CLI._ Both work out of the box — no `isolatedDeclarations` required. dtsx infers narrow types directly from your source values. If you do enable `isolatedDeclarations`, dtsx uses it as a fast path to skip initializer parsing when explicit type annotations are present.

### Library

```ts
import type { DtsGenerationOptions } from '@stacksjs/dtsx'
import { generate, processSource } from '@stacksjs/dtsx'

const options: DtsGenerationOptions = {
  cwd: './', // default: process.cwd()
  root: './src', // default: './src'
  entrypoints: ['**/*.{ts,tsx,mts,cts,vue,stx}'], // default
  outdir: './dist', // default: './dist'
  clean: true, // default: false
  verbose: true, // default: false
  keepComments: true, // default: true
  parallel: true, // default: false - process files in parallel
  concurrency: 4, // default: 4 - number of concurrent workers
  dryRun: false, // default: false - preview without writing
  stats: true, // default: false - show generation statistics
  validate: true, // default: false - validate generated .d.ts files
}

const stats = await generate(options)
console.log(`Generated ${stats.filesGenerated} files in ${stats.durationMs}ms`)

// You can also process source code directly:
const dtsContent = processSource(`
  export const greeting: string = "Hello";
  export function greet(name: string): string {
    return greeting + " " + name;
  }
`)
console.log(dtsContent)
// Output:
// export declare const greeting: string;
// export declare function greet(name: string): string;
```

Entrypoints, include patterns, and relative re-exports share normalized native
source paths. Overlapping matches generate each source once, including on
Windows. With `outputStructure: 'flat'`, nested sources emit directly into
`outdir`; distinct sources with the same declaration filename fail before
cleaning the previous declarations.
Directory barrels and graph entrypoints use the same native path identity as
discovered files, including absolute aliases containing `..` segments.

### STX Components

`.stx` files are declaration entrypoints alongside TypeScript and Vue files.
dtsx reads Vue-style `<script server|client>` blocks and Blade-style `@ts`
blocks, then emits an `@stacksjs/stx` `DefineComponent` declaration. Props are
derived from typed macros, runtime prop schemas, explicit `props as Props`
assertions, and legacy `$props.name` access:

```stx
<script server lang="ts">
interface CardProps {
  title: string
  count?: number
}

const props = withDefaults(defineProps<CardProps>(), { count: 0 })
</script>

<article>{{ props.title }}</article>
```

This emits `Card.d.ts` with `{ title: string; count?: number }` as its `$props`
contract. The same transform feeds the semantic inference path and the
annotation-first `isolatedDeclarations` path.

Library usage can also be configured using a `dts.config.ts` _(or `dts.config.js`)_ file, automatically loaded when running `./dtsx` _(or `bunx dtsx`)_ and when calling `generate()` unless custom options are provided.

```ts
// dts.config.ts (or dts.config.js)

export default {
  cwd: './',
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,
  verbose: true,
  // Performance options
  parallel: true,
  concurrency: 4,
  // Output options
  stats: true,
  validate: true,
  // Filtering
  exclude: ['**/*.test.ts', '**/**tests**/**'],
  importOrder: ['node:', 'bun', '@myorg/'],
}
```

_You may also run:_

```bash
./dtsx generate

# if the package is installed, you can also run
# bunx dtsx generate
```

### CLI

#### Generate Command

Generate declaration files using the default options:

```bash
dtsx generate
```

_Or use custom options:_

```bash
# Generate declarations for specific entry points
dtsx generate --entrypoints src/index.ts,src/utils.ts --outdir dist/types

# Generate declarations with custom configuration
dtsx generate --root ./lib --outdir ./types --clean

# Use parallel processing for large projects
dtsx generate --parallel --concurrency 8

# Preview what would be generated (dry run)
dtsx generate --dry-run --stats

# Validate generated declarations
dtsx generate --validate

# Exclude test files
dtsx generate --exclude "**/*.test.ts,**/**tests**/**"

# Custom import ordering
dtsx generate --import-order "node:,bun,@myorg/"

dtsx --help
dtsx --version
```

#### Watch Command

Watch for changes and regenerate automatically:

```bash
# Watch with default options
dtsx watch

# Watch specific directory
dtsx watch --root src --outdir dist/types
```

#### Stdin Command

Process TypeScript from stdin and output declarations to stdout:

```bash
# Pipe source code directly
echo "export const foo: string = 'bar'" | dtsx stdin

# Process a file through stdin
cat src/index.ts | dtsx stdin

# Chain with other tools
cat src/utils.ts | dtsx stdin > dist/utils.d.ts
```

#### Options

**Basic Options:**

- `--cwd <path>`: Set the current working directory _(default: current directory)_
- `--root <path>`: Specify the root directory of the project _(default: './src')_
- `--entrypoints <files>`: Define entry point files. Pass several by repeating the flag or separating them with commas _(default: `**/*.{ts,tsx,mts,cts,vue,stx}`)_
- `--outdir <path>`: Set the output directory for generated .d.ts files _(default: './dist')_
- `--keep-comments`: Keep comments in generated .d.ts files _(default: true)_
- `--clean`: Clean output directory before generation _(default: false)_
- `--tsconfig <path>`: Specify the path to tsconfig.json _(default: 'tsconfig.json')_

**Performance Options:**

- `--parallel`: Process files in parallel _(default: false)_
- `--concurrency <number>`: Number of concurrent workers with --parallel _(default: 4)_

**Output Options:**

- `--verbose`: Enable verbose output _(default: false)_
- `--log-level <level>`: Log level: debug, info, warn, error, silent _(default: 'info')_
- `--stats`: Show statistics after generation _(default: false)_
- `--output-format <format>`: Output format: text or json _(default: 'text')_
- `--progress`: Show progress during generation _(default: false)_
- `--diff`: Show diff of changes compared to existing files _(default: false)_

**Validation Options:**

- `--validate`: Validate generated .d.ts files against TypeScript _(default: false)_
- `--continue-on-error`: Continue processing if a file fails _(default: false)_
- `--dry-run`: Preview without writing files _(default: false)_

**Filtering Options:**

- `--exclude <patterns>`: Glob patterns to exclude _(comma-separated)_
- `--import-order <patterns>`: Import order priority patterns _(comma-separated)_

To learn more, head over to the [documentation](https://dtsx.stacksjs.org/).

## Type Inference

### dtsx vs tsc vs oxc

dtsx generates **sound, narrow types** with `@defaultValue` preservation — no `isolatedDeclarations` flag required, no explicit type annotations needed. Where tsc and oxc silently discard original values when widening types, dtsx preserves them as standard `@defaultValue` JSDoc so they surface in IDE hover tooltips. All output below is real — same source file, three tools, nothing hand-edited.

#### Why `@defaultValue`

In TypeScript, `const` only makes the _binding_ immutable — object properties and array elements remain mutable. This means `const config = { timeout: 5000 }` allows `config.timeout = 9999`, so the declared type must be `number`, not `5000`. All three tools correctly widen mutable container properties. The difference is what happens to the original values:

| Tool | Widened type | Original value preserved? |
|---|---|---|
| **dtsx**| `/** @defaultValue 5000 */ timeout: number` | Yes — via `@defaultValue` JSDoc |
| tsc | `timeout: number` | No — value lost entirely |
| oxc | `timeout: number` | No — value lost entirely |

#### Scalar Constants

Scalar `const` bindings are truly immutable — `const port = 3000` can never change. All tools keep the literal type:

```ts
// Source
export const port = 3000
export const debug = true
```

| | `port` | `debug` |
|---|---|---|
| **dtsx** | `3000` | `true` |
| tsc | `3000` | `true` |
| oxc | `3e3` _(mangled!)_ | `boolean` |

#### Object Properties — `@defaultValue` Preservation

```ts
// Source
export const config = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: 5000,
  features: { darkMode: true, notifications: false },
  routes: ['/', '/about', '/contact'],
}
```

| Property | dtsx | tsc | oxc |
|---|---|---|---|
| `apiUrl` | **`string`** + `@defaultValue 'https://...'` | `string` | `string` |
| `timeout` | **`number`** + `@defaultValue 5000` | `number` | `number` |
| `darkMode` | **`boolean`** + `@defaultValue true` | `boolean` | `boolean` |
| `routes` | **`string[]`** | `string[]` | `unknown` _(error)_ |
| **Top-level `@defaultValue`**|**full object literal** | _(none)_ | _(none)_ |

dtsx output:

```ts
/**

 _ @defaultValue
 _ ```ts
 _ {
 _ apiUrl: 'https://api.stacksjs.org',
 _ timeout: 5000,
 _ features: { darkMode: true, notifications: false },
 _ routes: ['/', '/about', '/contact']
 _ }
 _ ```

 _/
export declare const config: {
  /** @defaultValue 'https://api.stacksjs.org' */
  apiUrl: string;
  /** @defaultValue 5000 */
  timeout: number;
  features: {
    /** @defaultValue true */
    darkMode: boolean;
    /** @defaultValue false */
    notifications: boolean
  };
  routes: string[]
};
```

tsc and oxc output (values lost):

```ts
export declare const config: {
  apiUrl: string;
  timeout: number;
  features: { darkMode: boolean; notifications: boolean };
  routes: string[]  // oxc errors here
};
```

#### Generic Type Replacement

dtsx replaces broad generic annotations with narrow types inferred from the actual value:

```ts
// Source — generic index signature
export const conf: { [key: string]: string } = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: '5000',
}
```

| Tool | Output |
|---|---|
| **dtsx** | `{ apiUrl: 'https://api.stacksjs.org'; timeout: '5000' }` |
| tsc | `{ [key: string]: string }` — kept broad, lost all property info |
| oxc | `{ [key: string]: string }` — kept broad, lost all property info |

#### Deep `as const`

When you explicitly use `as const`, all tools should preserve literal types. dtsx handles this correctly:

```ts
// Source
export const CONFIG = {
  api: { baseUrl: 'https://api.example.com', timeout: 5000, retries: 3 },
  features: { darkMode: true, notifications: false },
  routes: ['/', '/about', '/contact'],
} as const
```

dtsx output — every value preserved as a literal, arrays become readonly tuples, no `@defaultValue` needed (types are already self-documenting):

```ts
export declare const CONFIG: {
  api: {
    baseUrl: 'https://api.example.com';
    timeout: 5000;
    retries: 3
  };
  features: {
    darkMode: true;
    notifications: false
  };
  routes: readonly ['/', '/about', '/contact']
};
```

#### Promise & Complex Types

```ts
export const promiseVal = Promise.resolve(42)
```

| Tool | Output |
|---|---|
| **dtsx** | `Promise<42>` _(resolved values are immutable)_ |
| tsc | `Promise<number>` |
| oxc | `unknown` _(error — requires explicit annotation)_ |

#### Full Comparison

| Declaration | dtsx | tsc | oxc |
|---|---|---|---|
| `const port = 3000` | `3000` | `3000` | `3e3` |
| `const debug = true` | `true` | `true` | `boolean` |
| `const items = [1,2,3]` | `number[]` + `@defaultValue` | `number[]` | `unknown` (error) |
| `config.apiUrl` | `string` + `@defaultValue` | `string` | `string` |
| `config.timeout` | `number` + `@defaultValue` | `number` | `number` |
| `config.routes` | `string[]` | `string[]` | `unknown` (error) |
| `conf` _(generic annotation)_ | exact properties | `{ [key]: string }` | `{ [key]: string }` |
| `Promise.resolve(42)` | `Promise<42>` | `Promise<number>` | `unknown` (error) |
| **Value info preserved?**|**Yes**|**No**|**No** |
| **Errors**|**0**|**0**|**3** |

dtsx produces **sound** types (correctly widened for mutable containers) while preserving original values via `@defaultValue` JSDoc — something neither tsc nor oxc does. No `as const`, no explicit annotations, no `isolatedDeclarations` flag required.

<!-- benchmarks:start -->

## Benchmarks

Measured on **Apple M3 Pro (`Mac15,6`), 11-core CPU (5 performance + 6 efficiency), 18 GB RAM, macOS 27.0.1 (arm64)** — 2026-11-08.
Bun 1.4.4 · Zig 0.17.1 · oxc-transform 0.157.0 · TypeScript 7.0.2 (native `tsc`) · tsdown 0.23.7.

Reproduce with `bun run benchmark:prepare && bun run benchmark:publish`. Raw numbers live in [`benchmark/results.json`](https://github.com/stacksjs/dtsx/blob/main/benchmark/results.json).

### How the comparison is kept fair

- Every tool emits real declarations for the same inputs; the harness verifies each tool's output before timing and aborts if any tool fails, so no row can time a crash.
- dtsx runs in its default value-inferring mode (narrow types and `@defaultValue` JSDoc), which does more work than isolated-declarations-only emitters.
- `tsc` is TypeScript 7's native Go compiler, run directly (no Node launcher) with `--noCheck`, its fastest declaration path. It has no in-process API, so it only appears in the CLI tables.
- oxc has no declaration CLI, so its CLI rows run a minimal Bun-compiled wrapper around `oxc-transform` (`bun build --compile --splitting --bytecode`).
- "No cache" means every dtsx cache is cleared on every iteration. The warm-cache table is reported separately and never used for comparisons.
- Times are means from [mitata](https://github.com/evanwashere/mitata); lower is better. **Bold** marks the fastest tool per column.

### In-process API (no cache)

_One file transformed in the same process: dtsx through its native binding, oxc-transform through N-API._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **dtsx** | **5.64 µs** | **11.74 µs** | **43.43 µs** | **153.10 µs** |
| oxc-transform | 6.60 µs _(1.17x)_ | 18.83 µs _(1.60x)_ | 45.25 µs _(1.04x)_ | 225.76 µs _(1.47x)_ |

### CLI: single file

_Each tool runs as an executable via subprocess, so process startup is included._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **dtsx** | **2.13 ms** | **2.11 ms** | **2.13 ms** | **2.34 ms** |
| oxc | 8.55 ms _(4.0x)_ | 8.65 ms _(4.1x)_ | 8.42 ms _(4.0x)_ | 8.61 ms _(3.7x)_ |
| tsc 7 | 28.10 ms _(13x)_ | 27.90 ms _(13x)_ | 27.78 ms _(13x)_ | 28.98 ms _(12x)_ |

### CLI: multi-file project

_A whole directory of generated modules. dtsx and tsc use multiple threads; the oxc wrapper processes files sequentially because oxc ships no parallel declaration CLI._

| Tool | 50 files | 100 files | 500 files |
|------|------|------|------|
| **dtsx** | **8.90 ms** | **14.59 ms** | **61.90 ms** |
| oxc | 20.75 ms _(2.3x)_ | 32.20 ms _(2.2x)_ | 125.04 ms _(2.0x)_ |
| tsc 7 | 53.92 ms _(6.1x)_ | 78.31 ms _(5.4x)_ | 291.59 ms _(4.7x)_ |

### JavaScript SDK

_The `@stacksjs/dtsx` SDK, which powers the bundler and build-tool plugins, called in-process like any other JavaScript SDK._

#### JS SDK: in-process, no cache

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|------|------|------|------|
| **oxc-transform** | **6.60 µs** | **18.83 µs** | **45.25 µs** | **225.76 µs** |
| dtsx JS SDK | 34.29 µs _(5.2x)_ | 50.06 µs _(2.7x)_ | 152.29 µs _(3.4x)_ | 637.78 µs _(2.8x)_ |

#### JS SDK: bundled declarations vs tsdown

_Fresh builds of the same project, checked by strict positive and negative consumer type-checks outside timing._

| Tool | 2 source files | 11 source files | 101 source files |
|------|------|------|------|
| **dtsx JS SDK** | **2.41 ms** | **6.18 ms** | **44.00 ms** |
| tsdown JS SDK | 35.09 ms _(14.6x)_ | 39.44 ms _(6.4x)_ | 70.01 ms _(1.6x)_ |

#### JS SDK: watch mode and incremental rebuilds

_The SDK's content-hash cache returns an unchanged file's declarations without re-scanning. No other tool here caches, so this is for reference only._

| | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|---|---|---|---|---|
| dtsx JS SDK (warm cache hit) | 96 ns | 260 ns | 385 ns | 1.43 µs |

<!-- benchmarks:end -->

### Binary Size

| Platform | dtsx | oxc | tsgo | tsc |
|----------|------|-----|------|-----|
| macOS arm64 | **479 KB** | 3.7 MB _(8x)_ | 27.7 MB _(59x)_ | 22.5 MB _(48x)_ |
| macOS x64 | **515 KB** | 4.0 MB _(8x)_ | 28.6 MB _(57x)_ | 22.5 MB _(45x)_ |
| Linux x64 | **613 KB** | 4.6 MB _(8x)_ | 28.1 MB _(47x)_ | 22.5 MB _(38x)_ |
| Linux arm64 | **524 KB** | 4.1 MB _(8x)_ | 27.1 MB _(53x)_ | 22.5 MB _(44x)_ |
| Windows x64 | **757 KB** | 3.7 MB _(5x)_ | 28.7 MB _(39x)_ | 22.5 MB _(30x)_ |
| FreeBSD x64 | **502 KB** | 4.3 MB _(9x)_ | — | 22.5 MB _(46x)_ |

## Testing

Install the pinned tools and dependencies through Pantry, then build the actual native producer before running its consumers:

```bash
pantry install --frozen-lockfile
eval "$(pantry env)"
(cd packages/zig-dtsx && zig build && zig build test)
bun run test
```

Before publication, build the core and every adapter, then check their normal package archives in strict installed SDK consumers:

```bash
bun run build
bun --filter './packages/*-plugin' build
bun run typecheck:public-sdk
bun run test:public-sdk
```

The SDK gate checks advertised exports, runtime dependency edges, normal/frozen installs, installed payload hashes, strict NodeNext typing, precise invalid consumers and Bun imports. It also checks the optional formatter with its provider present and absent. The command prints an evidence directory containing raw command logs and `receipt.json`; set `DTSX_SDK_EVIDENCE` to choose its parent directory. Failed installations stay intact. Passed consumers release their derived `node_modules` after all checks; archives, locks, probes, logs and payload hashes remain available. Set `DTSX_SDK_KEEP_INSTALLS=1` to retain passed installations too. Its owned candidate registry serves the exact archives without changing their manifests. Public registry releases and native artifacts require separate verification. CI retains this evidence and blocks publication when any SDK or advertised host-provider baseline fails.

## Changelog

Please see our [releases](https://github.com/stacksjs/dtsx/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://stacksjs.com/discord)

## Postcardware

“Software that is free, but hopes for a postcard.” We love receiving postcards from around the world showing where `dtsx` is being used! We showcase them on our website too.

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094, United States 🌎

## Sponsors

We would like to extend our thanks to the following sponsors for funding Stacks development. If you are interested in becoming a sponsor, please reach out to us.

- [JetBrains](https://www.jetbrains.com/)
- [The Solana Foundation](https://solana.com/)

## Credits

- [Chris Breuer](https://github.com/chrisbbreuer)
- [All Contributors](../../contributors)

## License

The MIT License (MIT). Please see [LICENSE](https://github.com/stacksjs/dtsx/tree/main/LICENSE.md) for more information.

Made with 💙

<!-- Badges -->

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/dtsx/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/dtsx -->
