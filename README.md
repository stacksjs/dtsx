<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# dtsx

> A library that helps you generate TypeScript declaration files from your project. Given we do not know the user's input ever, we need to never hardcode based results based from our examples, always create a dynamic solution.

## Features

- 🎯 Narrowest possible type inference — no `isolatedDeclarations` needed
- ⚡ Extremely fast .d.ts generation
- 🔄 Parallel processing support
- 📥 Stdin/stdout support for piping
- ⚙️ Highly configurable
- 🪶 Lightweight library
- 🤖 Cross-platform binary
- 👀 Watch mode for development
- ✅ Built-in validation

## Type Inference — dtsx vs oxc vs tsc

dtsx generates the **narrowest possible types** from your source values — no `isolatedDeclarations` flag required, no explicit type annotations needed. Where other tools emit broad types like `string`, `number`, or `number[]`, dtsx preserves the exact literal types from your code.

All output below is real — same source file, three tools, nothing hand-edited.

### Literal Types

```ts
// Source
export const port = 3000
export const debug = true
export const items = [1, 2, 3]
```

| | `port` | `debug` | `items` |
|---|---|---|---|
| **dtsx** | **`3000`** | **`true`** | **`readonly [1, 2, 3]`** |
| oxc | `3e3` _(mangled!)_ | `boolean` | `unknown` _(error)_ |
| tsc | `3000` | `true` | `number[]` |

> oxc and tsc only narrow arrays when you add explicit `as const`. dtsx always narrows.

### Object Properties

```ts
// Source
export const config = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: 5000,
  features: { darkMode: true, notifications: false },
  routes: ['/', '/about', '/contact'],
}
```

| Property | dtsx | oxc | tsc |
|---|---|---|---|
| `apiUrl` | **`'https://api.stacksjs.org'`** | `string` | `string` |
| `timeout` | **`5000`** | `number` | `number` |
| `darkMode` | **`true`** | `boolean` | `boolean` |
| `routes` | **`readonly ['/', '/about', '/contact']`** | `unknown` _(error)_ | `string[]` |

### Generic Type Replacement

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
| oxc | `{ [key: string]: string }` — kept broad, lost all property info |
| tsc | `{ [key: string]: string }` — kept broad, lost all property info |

### Deep as const

```ts
// Source
export const CONFIG = {
  api: { baseUrl: 'https://api.example.com', timeout: 5000, retries: 3 },
  features: { darkMode: true, notifications: false },
  routes: ['/', '/about', '/contact'],
} as const
```

dtsx output — every value preserved as a literal, arrays become readonly tuples, full depth:

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

### Promise & Complex Types

```ts
export const promiseVal = Promise.resolve(42)
```

| Tool | Output |
|---|---|
| **dtsx** | `Promise<42>` |
| oxc | `unknown` _(error — requires explicit annotation)_ |
| tsc | `Promise<number>` |

### Full Comparison

| Declaration | dtsx | oxc | tsc |
|---|---|---|---|
| `const port = 3000` | `3000` | `3e3` | `3000` |
| `const debug = true` | `true` | `boolean` | `true` |
| `const items = [1,2,3]` | `readonly [1,2,3]` | `unknown` (error) | `number[]` |
| `config.apiUrl` | `'https://...'` | `string` | `string` |
| `config.timeout` | `5000` | `number` | `number` |
| `config.routes` | readonly tuple | `unknown` (error) | `string[]` |
| `conf` _(generic annotation)_ | exact properties | `{ [key]: string }` | `{ [key]: string }` |
| `Promise.resolve(42)` | `Promise<42>` | `unknown` (error) | `Promise<number>` |
| **Errors** | **0** | **3** | **0** |

dtsx infers the narrowest possible type from every value — no `as const`, no explicit annotations, no `isolatedDeclarations` flag required. Just write normal TypeScript.

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

## Get Started

There are two ways of using this ".d.ts generation" tool: _as a library or as a CLI._

_dtsx works out of the box — no `isolatedDeclarations` required. It infers narrow types directly from your source values. If you do enable `isolatedDeclarations`, dtsx uses it as a fast path to skip initializer parsing when explicit type annotations are present._

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true // optional — dtsx works great without it
  }
}
```

## Library

Given the npm package is installed, you can use the `generate` function to generate TypeScript declaration files from your project.

### Usage

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
  // New options:
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

_Available options:_

Library usage can also be configured using a `dts.config.ts` _(or `dts.config.js`)_ file which is automatically loaded when running the `./dtsx` _(or `bunx dtsx`)_ command. It is also loaded when the `generate` function is called, unless custom options are provided.

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
  exclude: ['**/*.test.ts', '**/__tests__/**'],
  importOrder: ['node:', 'bun', '@myorg/'],
}
```

_You may also run:_

```bash
./dtsx generate

# if the package is installed, you can also run:
# bunx dtsx generate
```

## CLI

The `dtsx` CLI provides a simple way to generate TypeScript declaration files from your project. Here's how to use it:

### Generate Command

Generate declaration files using the default options:

```bash
dtsx generate
```

_Or use custom options:_

```bash
# Generate declarations for specific entry points:
dtsx generate --entrypoints src/index.ts,src/utils.ts --outdir dist/types

# Generate declarations with custom configuration:
dtsx generate --root ./lib --outdir ./types --clean

# Use parallel processing for large projects:
dtsx generate --parallel --concurrency 8

# Preview what would be generated (dry run):
dtsx generate --dry-run --stats

# Validate generated declarations:
dtsx generate --validate

# Exclude test files:
dtsx generate --exclude "**/*.test.ts,**/__tests__/**"

# Custom import ordering:
dtsx generate --import-order "node:,bun,@myorg/"

dtsx --help
dtsx --version
```

### Watch Command

Watch for changes and regenerate automatically:

```bash
# Watch with default options:
dtsx watch

# Watch specific directory:
dtsx watch --root src --outdir dist/types
```

### Stdin Command

Process TypeScript from stdin and output declarations to stdout:

```bash
# Pipe source code directly:
echo "export const foo: string = 'bar'" | dtsx stdin

# Process a file through stdin:
cat src/index.ts | dtsx stdin

# Chain with other tools:
cat src/utils.ts | dtsx stdin > dist/utils.d.ts
```

### Available Options

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

## Benchmarks

Benchmarked on Apple M3 Pro, macOS _(bun 1.3.10, arm64-darwin)_. Run `bun benchmark/index.ts` to reproduce.

### In-Process API — Cached

_dtsx uses smart caching (hash check + cache hit) for watch mode, incremental builds, and CI pipelines._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **dtsx (cached)** | **0.95 µs** | **2.16 µs** | **19.84 µs** | **105.83 µs** |
| zig-dtsx | 4.60 µs _(4.8x)_ | 11.27 µs _(5.2x)_ | 26.75 µs _(1.3x)_ | 230.91 µs _(2.2x)_ |
| oxc-transform | 6.76 µs _(7.1x)_ | 20.54 µs _(9.5x)_ | 79.54 µs _(4.0x)_ | 519.44 µs _(4.9x)_ |
| tsc | 194.34 µs _(205x)_ | 438.12 µs _(203x)_ | 1.14 ms _(57x)_ | 4.20 ms _(40x)_ |

### In-Process API — No Cache

_Cache cleared every iteration for raw single-transform comparison._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **zig-dtsx** | **4.68 µs** | **11.43 µs** | **27.89 µs** | **230.32 µs** |
| oxc-transform | 6.95 µs _(1.5x)_ | 21.05 µs _(1.8x)_ | 81.46 µs _(2.9x)_ | 519.01 µs _(2.3x)_ |
| dtsx (no-cache) | 10.42 µs _(2.2x)_ | 23.06 µs _(2.0x)_ | 67.79 µs _(2.4x)_ | 400.81 µs _(1.7x)_ |
| tsc | 155.16 µs _(33x)_ | 389.90 µs _(34x)_ | 918.21 µs _(33x)_ | 3.82 ms _(17x)_ |

### CLI — Single File

_All tools run as compiled native binaries via subprocess._

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **zig-dtsx** | **2.32 ms** | **2.31 ms** | **2.42 ms** | **2.46 ms** |
| oxc | 16.51 ms _(7.1x)_ | 15.71 ms _(6.8x)_ | 16.41 ms _(6.8x)_ | 16.14 ms _(6.6x)_ |
| dtsx | 29.42 ms _(12.7x)_ | 29.36 ms _(12.7x)_ | 30.96 ms _(12.8x)_ | 32.30 ms _(13.1x)_ |
| tsgo | 38.70 ms _(16.7x)_ | 41.97 ms _(18.2x)_ | 42.09 ms _(17.4x)_ | 52.83 ms _(21.5x)_ |
| tsc | 347.31 ms _(150x)_ | 374.30 ms _(162x)_ | 376.76 ms _(156x)_ | 403.00 ms _(164x)_ |

### Multi-File Project

| Tool | 50 files | 100 files | 500 files |
|------|----------|-----------|-----------|
| **zig-dtsx** | **12.16 ms** | **23.23 ms** | **109.33 ms** |
| oxc | 35.38 ms _(2.9x)_ | 58.62 ms _(2.5x)_ | 402.32 ms _(3.7x)_ |
| dtsx | 55.21 ms _(4.5x)_ | 79.14 ms _(3.4x)_ | 281.40 ms _(2.6x)_ |
| tsgo | 210.54 ms _(17.3x)_ | 413.69 ms _(17.8x)_ | 2.18 s _(20.0x)_ |
| tsc | 774.44 ms _(63.7x)_ | 1.18 s _(50.6x)_ | 3.99 s _(36.5x)_ |

### Binary Size

| Platform | Zig Binary | Bun Binary | Reduction |
|----------|-----------|------------|-----------|
| macOS arm64 | 659 KB | 61 MB | **95x smaller** |
| macOS x64 | 716 KB | 67 MB | **96x smaller** |
| Linux x64 | 6.2 MB | 108 MB | **17x smaller** |
| Linux arm64 | 6.3 MB | 103 MB | **16x smaller** |
| Windows x64 | 1.0 MB | 101 MB | **101x smaller** |
| FreeBSD x64 | 5.5 MB | — | — |

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
