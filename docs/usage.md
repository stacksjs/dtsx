# Get Started

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
  // keepComments: true, // coming soon
}

await generate(options)
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

### Usage

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
- `--verbose`: Enable verbose output _(default: false)_

To learn more, head over to the [documentation](https://dtsx.stacksjs.org/).
