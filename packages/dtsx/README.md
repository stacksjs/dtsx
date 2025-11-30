<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.jpg?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

# dtsx

> A blazing-fast TypeScript declaration file (.d.ts) generator with advanced features like incremental builds, watch mode, bundling, and IDE integration.

## Features

- ⚡ Extremely fast .d.ts generation
- 🔄 Watch mode with incremental builds
- 📦 Declaration bundling support
- 🔌 Plugin system for custom transformations
- 🧩 Monorepo/workspace support
- 🛠️ IDE integration via LSP
- ⚙️ Highly configurable
- 🪶 Lightweight library
- 🤖 Cross-platform binary

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
import { generate } from '@stacksjs/dtsx'

const options: DtsGenerationOptions = {
  cwd: './', // default: process.cwd()
  root: './src', // default: './src'
  entrypoints: ['**/*.ts'], // default: ['**/*.ts']
  outdir: './dist', // default: './dist'
  clean: true, // default: false
  verbose: true, // default: false
  keepComments: true, // default: true
}

await generate(options)
```

### Configuration File

Library usage can also be configured using a `dts.config.ts` _(or `dts.config.js`)_ file which is automatically loaded when running the `./dtsx` _(or `bunx dtsx`)_ command. It is also loaded when the `generate` function is called, unless custom options are provided.

```ts
// dts.config.ts (or dts.config.js)
import { defineConfig } from '@stacksjs/dtsx'

export default defineConfig({
  cwd: './',
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,
  verbose: true,

  // Advanced options
  watch: false, // Enable watch mode
  incremental: false, // Enable incremental builds
  parallel: false, // Enable parallel processing
  concurrency: 4, // Number of parallel workers

  // Bundling
  bundle: false, // Bundle all declarations into one file
  bundleOutput: 'index.d.ts', // Output filename when bundling

  // Output formatting
  prettier: false, // Use Prettier for formatting
  indentStyle: 'spaces', // 'spaces' or 'tabs'
  indentSize: 2, // Number of spaces

  // Plugins
  plugins: [],
})
```

_You may also run:_

```bash
./dtsx generate

# if the package is installed, you can also run:
# bunx dtsx generate
```

## CLI

The `dtsx` CLI provides a comprehensive set of commands for generating and managing TypeScript declaration files.

### Commands

#### Generate Declarations

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

# Enable incremental builds
dtsx generate --incremental

# Enable parallel processing
dtsx generate --parallel --concurrency 8
```

#### Watch Mode

Watch for file changes and automatically regenerate declarations:

```bash
dtsx watch

# Watch with custom options
dtsx watch --root ./src --outdir ./dist --debounce 300
```

#### Bundle Declarations

Bundle multiple declaration files into a single file:

```bash
# Bundle declarations using the generate command with --bundle flag
dtsx generate --bundle --bundle-output index.d.ts

# Or with custom output directory
dtsx generate --outdir ./dist --bundle --bundle-output types.d.ts
```

#### Workspace/Monorepo Support

Generate declarations for all packages in a monorepo:

```bash
dtsx workspace

# Specify packages directory
dtsx workspace --packages ./packages
```

#### Type Checking

Run type checking with isolated declarations support:

```bash
dtsx check

# Check specific files
dtsx check --files "src/**/*.ts"
```

#### Circular Dependency Detection

Detect circular dependencies in your TypeScript files:

```bash
dtsx circular

# Output as JSON or DOT (Graphviz) format
dtsx circular --format json
dtsx circular --format dot
```

#### Generate Documentation

Generate API documentation from your TypeScript files:

```bash
dtsx docs

# Specify output format
dtsx docs --format markdown
dtsx docs --format html
dtsx docs --format json
```

#### Optimize Declarations

Optimize and tree-shake declaration files:

```bash
dtsx optimize

# Optimize specific files
dtsx optimize --files "dist/**/*.d.ts"
```

#### Convert Types

Convert TypeScript types to different schema formats:

```bash
dtsx convert --format zod
dtsx convert --format json-schema
dtsx convert --format valibot
```

#### LSP Server

Start the Language Server Protocol server for IDE integration:

```bash
dtsx lsp
```

#### Read from Stdin

Accept TypeScript code from stdin:

```bash
echo "export function foo(): string { return 'bar' }" | dtsx stdin
```

### CLI Options

#### Global Options

- `--cwd <path>`: Set the current working directory _(default: current directory)_
- `--verbose`: Enable verbose output _(default: false)_
- `--help`: Show help information
- `--version`: Show version number

#### Generate Options

- `--root <path>`: Specify the root directory of the project _(default: './src')_
- `--entrypoints <files>`: Define entry point files _(comma-separated, default: '**/*.ts')_
- `--outdir <path>`: Set the output directory for generated .d.ts files _(default: './dist')_
- `--keep-comments`: Keep comments in generated .d.ts files _(default: true)_
- `--clean`: Clean output directory before generation _(default: false)_
- `--tsconfig <path>`: Specify the path to tsconfig.json _(default: 'tsconfig.json')_
- `--incremental`: Enable incremental builds _(default: false)_
- `--parallel`: Enable parallel processing _(default: false)_
- `--concurrency <n>`: Number of parallel workers _(default: 4)_
- `--dry-run`: Show what would be generated without writing files
- `--diff`: Show differences from existing .d.ts files
- `--validate`: Validate generated .d.ts against TypeScript compiler
- `--stats`: Show generation statistics
- `--progress`: Show progress during generation
- `--output-format <format>`: Output format: 'text' or 'json' _(default: 'text')_

#### Watch Options

- `--debounce <ms>`: Debounce delay in milliseconds _(default: 100)_

#### Bundle Options (use with generate command)

- `--bundle`: Enable bundling of declarations into a single file
- `--bundle-output <file>`: Output filename when bundling _(default: 'index.d.ts')_

To learn more, head over to the [documentation](https://dtsx.stacksjs.org/).

## Build Tool Integration

dtsx provides plugins for popular build tools:

### Vite

```ts
// vite.config.ts
import { dts } from '@stacksjs/dtsx/vite'

export default {
  plugins: [dts()],
}
```

### esbuild

```ts
// build.ts
import { dtsx } from '@stacksjs/dtsx/esbuild'

await esbuild.build({
  plugins: [dtsx()],
})
```

### webpack

```ts
// webpack.config.js
const { DtsxWebpackPlugin } = require('@stacksjs/dtsx/webpack')

module.exports = {
  plugins: [new DtsxWebpackPlugin()],
}
```

### tsup

```ts
// tsup.config.ts
import { dtsxPlugin } from '@stacksjs/dtsx/tsup'

export default {
  plugins: [dtsxPlugin()],
}
```

### Bun

```ts
// build.ts
import { dts } from '@stacksjs/dtsx/bun'

await Bun.build({
  plugins: [dts()],
})
```

## Documentation

- [Architecture Guide](../../ARCHITECTURE.md) - How dtsx works internally
- [Contributing Guide](../../CONTRIBUTING.md) - How to contribute to dtsx
- [Performance Guide](../../PERFORMANCE.md) - Tips for optimizing large codebases
- [Migration Guide](../../MIGRATION.md) - Migrating from other tools
- [Troubleshooting](../../TROUBLESHOOTING.md) - Common issues and solutions

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

"Software that is free, but hopes for a postcard." We love receiving postcards from around the world showing where `dtsx` is being used! We showcase them on our website too.

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
