<p align="center"><img src="https://github.com/stacksjs/dtsx/blob/main/.github/art/cover.png?raw=true" alt="Social Card of this repo"></p>

[![npm version][npm-version-src]][npm-version-href]
[![GitHub Actions][github-actions-src]][github-actions-href]
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
<!-- [![npm downloads][npm-downloads-src]][npm-downloads-href] -->
<!-- [![Codecov][codecov-src]][codecov-href] -->

## Features

- Fast .d.ts generation _(via isolatedDeclaration)_
- Highly configurable
- Cross-platform binary
- Lightweight & dependency-free library

## Install

```bash
bun install -d @stacksjs/dtsx
```

_@npm.js, please allow us to use the `dtsx` package name 🙏_,

<!-- _Alternatively, you can install:_

```bash
brew install dtsx # wip
pkgx install dtsx # wip
``` -->

## Get Started

There are two ways of using this ".d.ts generation" tool: _as a library or as a CLI._

### Library

Given the npm package is installed, you can use the `generate` function to generate TypeScript declaration files from your project.

#### Usage

```ts
import { generate } from '@stacksjs/dtsx'

interface Options {
  cwd?: string            // default: process.cwd()
  root?: string           // default: './src'
  entrypoints?: string[]  // default: ['**/*.ts']
  outdir?: string         // default: './dist'
  keepComments?: boolean  // default: true
  clean?: boolean         // default: false
  tsconfigPath?: string   // default: './tsconfig.json'
}

await generate(options?: Options)
```

_Available options:_

The library can configured using a `dts.config.ts` _(or `dts.config.js`)_ file and it will be automatically loaded when running the `./dtsx` _(or `bunx dtsx`)_ command.

```ts
// dts.config.ts (or dts.config.js)
export default {
  cwd: './',
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,
}
```

_Then run:_

```bash
./dtsx generate

# or, you may use
# bunx dtsx generate
```

### CLI

The `dtsx` CLI provides a simple way to generate TypeScript declaration files from your project. Here's how to use it:

#### Usage

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

dtsx --help
dtsx --version
```

_Available options:_

- `--cwd <path>`: Set the current working directory _(default: current directory)_
- `--root <path>`: Specify the root directory of the project _(default: './src')_
- `--entrypoints <files>`: Define entry point files _(comma-separated, default: '**/*.ts')_
- `--outdir <path>`: Set the output directory for generated .d.ts files _(default: './dist')_
- `--keep-comments`: Keep comments in generated .d.ts files _(default: true)_
- `--clean`: Clean output directory before generation _(default: false)_
- `--tsconfig <path>`: Specify the path to tsconfig.json _(default: 'tsconfig.json')_

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

Two things are true: Stacks OSS will always stay open-source, and we do love to receive postcards from wherever Stacks is used! 🌍 _We also publish them on our website. And thank you, Spatie_

Our address: Stacks.js, 12665 Village Ln #2306, Playa Vista, CA 90094

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
