<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# dtsx

> A library that helps you generate TypeScript declaration files from your project. Given we do not know the user's input ever, we need to never hardcode based results based from our examples, always create a dynamic solution.

## Features

- ⚡ Extremely fast .d.ts generation
- 🔄 Parallel processing support
- 📥 Stdin/stdout support for piping
- ⚙️ Highly configurable
- 🪶 Lightweight library
- 🤖 Cross-platform binary
- 👀 Watch mode for development
- ✅ Built-in validation

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

_But before you get started, please ensure you enabled `isolatedDeclarations` in your `tsconfig.json` file._

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true
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
