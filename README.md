<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
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

> [!NOTE]
> dtsx works out of the box without `isolatedDeclarations` — it infers narrow types directly from your source values. That said, enabling `isolatedDeclarations` is still a good idea as it enforces explicit type annotations at module boundaries, encouraging better type hygiene across your codebase. When enabled, dtsx uses it as a fast path to skip initializer parsing where annotations are already present.

## Install

```bash
bun install -d @stacksjs/dtsx
```

_@npmjs.com, please allow us to use the `dtsx` package name 🙏_

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
  entrypoints: ['**/*.ts'], // default: ['**/*.ts']
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
- `--entrypoints <files>`: Define entry point files _(comma-separated, default: '**/*.ts')_
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
| **dtsx**| `/** @defaultValue 5000 */ timeout: number` | **Yes** — via `@defaultValue` JSDoc |
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

## Benchmarks

Benchmarked on Apple M3 Pro, macOS _(bun 1.3.11, arm64-darwin)_. Run `bun benchmark/index.ts` to reproduce.

### In-Process API — No Cache

_Raw single-transform comparison (cache cleared every iteration)._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **zig-dtsx**|**3.37 µs**|**7.05 µs**|**21.89 µs**|**144.89 µs** |
| oxc-transform | 7.36 µs _(2.2x)_ | 21.91 µs _(3.1x)_ | 89.66 µs _(4.1x)_ | 560.86 µs _(3.9x)_ |
| dtsx | 15.52 µs _(4.6x)_ | 34.06 µs _(4.8x)_ | 81.96 µs _(3.7x)_ | 573.92 µs _(4.0x)_ |
| tsc | 169.69 µs _(50.4x)_ | 410.31 µs _(58.2x)_ | 1.03 ms _(47.1x)_ | 4.02 ms _(27.7x)_ |

### In-Process API — Cached

_Smart caching (hash check + cache hit) for watch mode, incremental builds, and CI._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **dtsx**|**97.81 ns**|**162.55 ns**|**376.39 ns**|**1.43 µs** |
| zig-dtsx | 3.43 µs _(35.0x)_ | 7.16 µs _(44.0x)_ | 22.00 µs _(58.5x)_ | 147.21 µs _(103.0x)_ |
| oxc-transform | 7.35 µs _(75.1x)_ | 22.66 µs _(139.4x)_ | 85.77 µs _(227.9x)_ | 558.72 µs _(390.7x)_ |
| tsc | 236.82 µs _(2421x)_ | 463.06 µs _(2849x)_ | 1.53 ms _(4065x)_ | 4.66 ms _(3259x)_ |

### CLI — Single File

_Compiled native binaries via subprocess._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **zig-dtsx**|**2.69 ms**|**2.35 ms**|**2.28 ms**|**3.14 ms** |
| oxc | 17.08 ms _(6.3x)_ | 17.12 ms _(7.3x)_ | 17.95 ms _(7.9x)_ | 17.69 ms _(5.6x)_ |
| tsgo | 40.53 ms _(15.1x)_ | 44.10 ms _(18.8x)_ | 44.39 ms _(19.5x)_ | 57.77 ms _(18.4x)_ |
| tsc | 384.25 ms _(142.8x)_ | 407.51 ms _(173.4x)_ | 418.81 ms _(183.7x)_ | 454.74 ms _(144.8x)_ |

### Multi-File Project

| Tool | 50 files | 100 files | 500 files |
|------|----------|-----------|-----------|
| **zig-dtsx**|**18.10 ms**|**31.46 ms**|**~140 ms** |
| oxc | 48.27 ms _(2.7x)_ | 79.00 ms _(2.5x)_ | ~365 ms _(2.6x)_ |
| tsgo | 244.68 ms _(13.5x)_ | 419.65 ms _(13.3x)_ | - |
| tsc | 871.48 ms _(48.1x)_ | - | - |

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

```bash
bun test
```

## Changelog

Please see our [releases](https://github.com/stacksjs/stacks/releases) page for more information on what has changed recently.

## Contributing

Please review the [Contributing Guide](https://github.com/stacksjs/contributing) for details.

## Community

For help, discussion about best practices, or any other conversation that would benefit from being searchable:

[Discussions on GitHub](https://github.com/stacksjs/stacks/discussions)

For casual chit-chat with others using this package:

[Join the Stacks Discord Server](https://discord.gg/stacksjs)

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
[npm-version-src]: https://img.shields.io/npm/v/@stacksjs/dtsx?style=flat-square
[npm-version-href]: https://npmjs.com/package/@stacksjs/dtsx
[github-actions-src]: https://img.shields.io/github/actions/workflow/status/stacksjs/dtsx/ci.yml?style=flat-square&branch=main
[github-actions-href]: https://github.com/stacksjs/dtsx/actions?query=workflow%3Aci

<!-- [codecov-src]: https://img.shields.io/codecov/c/gh/stacksjs/dtsx/main?style=flat-square
[codecov-href]: https://codecov.io/gh/stacksjs/dtsx -->
