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
import type { DtsGenerationConfig } from '@stacksjs/dtsx'
import { generate } from '@stacksjs/dtsx'

const config: DtsGenerationConfig = {
  cwd: './', // default: process.cwd()
  root: './src', // default: './src'
  entrypoints: ['**/*.ts'], // default: ['**/*.ts']
  outdir: './dist', // default: './dist'
  keepComments: true, // default: true
  clean: true, // default: true
  tsconfigPath: './tsconfig.json', // default: './tsconfig.json'
  outputStructure: 'mirror', // default: 'mirror' | 'flat'
  verbose: false, // default: false
}

await generate(config)
```

### Partial Configuration

You can also provide partial configuration, and defaults will be used for missing options:

```ts
import { generate } from '@stacksjs/dtsx'

// Minimal configuration
await generate({
  root: './lib',
  outdir: './types',
})

// With comment preservation disabled
await generate({
  root: './src',
  outdir: './dist',
  keepComments: false,
})
```

### Configuration File

Library usage can also be configured using a `dts.config.ts` _(or `dts.config.js`)_ file which is automatically loaded when running the `./dtsx` _(or `bunx dtsx`)_ command. It is also loaded when the `generate` function is called, unless custom options are provided.

```ts
// dts.config.ts (or dts.config.js)
import type { DtsGenerationConfig } from '@stacksjs/dtsx'

const config: DtsGenerationConfig = {
  cwd: './',
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,
  outputStructure: 'mirror',
  verbose: false,
}

export default config
```

_You may also run:_

```bash
./dtsx generate

# if the package is installed, you can also run:
# bunx dtsx generate
```

## CLI

The `dtsx` CLI provides a simple way to generate TypeScript declaration files from your project. Here's how to use it:

### Basic Usage

Generate declaration files using the default options:

```bash
dtsx generate
```

Or use the default command (same as `generate`):

```bash
dtsx
```

### Custom Options

Use custom options to override defaults:

```bash
# Generate declarations for specific entry points:
dtsx generate --entrypoints src/index.ts,src/utils.ts --outdir dist/types

# Generate declarations with custom configuration:
dtsx generate --root ./lib --outdir ./types --clean

# Disable comment preservation:
dtsx generate --keep-comments=false

# Enable verbose logging:
dtsx generate --verbose

# Use flat output structure:
dtsx generate --output-structure flat
```

### CLI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--cwd <path>` | `string` | current directory | Set the current working directory |
| `--root <path>` | `string` | `'./src'` | Specify the root directory of the project |
| `--entrypoints <files>` | `string` | `'**/*.ts'` | Define entry point files (comma-separated) |
| `--outdir <path>` | `string` | `'./dist'` | Set the output directory for generated .d.ts files |
| `--keep-comments [value]` | `boolean` | `true` | Keep comments in generated .d.ts files |
| `--clean` | `boolean` | `true` | Clean output directory before generation |
| `--tsconfig <path>` | `string` | `'tsconfig.json'` | Specify the path to tsconfig.json |
| `--output-structure <type>` | `'mirror' \| 'flat'` | `'mirror'` | Set output directory structure |
| `--verbose` | `boolean` | `false` | Enable verbose output |

### CLI Examples

```bash
# Basic generation
dtsx

# Generate with specific entry points
dtsx --entrypoints "src/index.ts,src/types.ts"

# Generate with flat structure
dtsx --root ./lib --outdir ./types --output-structure flat

# Generate without comments
dtsx --keep-comments=false

# Generate with verbose logging
dtsx --verbose

# Generate with custom tsconfig
dtsx --tsconfig ./tsconfig.build.json

# Clean and generate
dtsx --clean --verbose
```

### Version and Help

```bash
# Show version
dtsx --version
dtsx version

# Show help
dtsx --help
```

## Advanced Usage

### Multiple Entry Points

You can specify multiple entry points using glob patterns:

```ts
await generate({
  entrypoints: [
    'src/index.ts',
    'src/components/**/*.ts',
    'src/utils/**/*.ts',
    '!src/**/*.test.ts', // Exclude test files
  ],
})
```

### Output Structure Options

Choose between mirroring source structure or flat output:

```ts
// Mirror source structure (default)
await generate({
  outputStructure: 'mirror',
})
// src/components/Button.ts → dist/components/Button.d.ts

// Flat structure
await generate({
  outputStructure: 'flat',
})
// src/components/Button.ts → dist/Button.d.ts
```

### Comment Preservation

Control comment preservation in generated declarations:

```ts
// Preserve all comments (default)
await generate({
  keepComments: true,
})

// Remove comments for smaller output
await generate({
  keepComments: false,
})
```

When `keepComments` is enabled, the following are preserved:
- JSDoc comments with tags (`@param`, `@returns`, `@example`, etc.)
- Block comments (`/* ... */`)
- Single-line comments (`//`)

### Error Handling

```ts
import { generate } from '@stacksjs/dtsx'

try {
  await generate({
    root: './src',
    outdir: './dist',
  })
  console.log('✅ Declaration files generated successfully!')
} catch (error) {
  console.error('❌ Failed to generate declaration files:', error)
  process.exit(1)
}
```

### Integration with Build Tools

#### Package.json Scripts

```json
{
  "scripts": {
    "build:types": "dtsx",
    "build:types:clean": "dtsx --clean",
    "build:types:verbose": "dtsx --verbose",
    "build:types:flat": "dtsx --output-structure flat"
  }
}
```

#### With Build Pipelines

```bash
# In CI/CD or build scripts
npm run build:types
# or
bunx dtsx --clean --verbose
```

To learn more, head over to the [documentation](https://dtsx.stacksjs.org/).
