---
title: Getting Started
description: Learn how to install and use dtsx for TypeScript declaration file generation.
---

# Getting Started

dtsx is an extremely fast TypeScript declaration file (`.d.ts`) generator that leverages isolated declarations for optimal performance.

## Prerequisites

- [Bun](https://bun.sh) v1.0.0 or higher
- TypeScript with `isolatedDeclarations` enabled in your `tsconfig.json`

## Installation

```bash
# Using Bun (recommended)
bun add -d @stacksjs/dtsx

# Using npm
npm install -D @stacksjs/dtsx

# Using pnpm
pnpm add -D @stacksjs/dtsx
```

## Enable Isolated Declarations

Before using dtsx, ensure your `tsconfig.json` has isolated declarations enabled:

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true
  }
}
```

## Quick Start

### CLI Usage

Generate declaration files for your project:

```bash
# Generate with default options
bunx dtsx generate

# Generate with custom options
bunx dtsx generate --root ./src --outdir ./dist
```

### Library Usage

Use dtsx programmatically in your build scripts:

```ts
import { generate, processSource } from '@stacksjs/dtsx'

// Generate declarations for your project
const stats = await generate({
  root: './src',
  outdir: './dist',
  clean: true,
})

console.log(`Generated ${stats.filesGenerated} files in ${stats.durationMs}ms`)
```

### Process Source Directly

Transform TypeScript source code to declarations:

```ts
import { processSource } from '@stacksjs/dtsx'

const source = `
  export const greeting: string = "Hello";
  export function greet(name: string): string {
    return greeting + " " + name;
  }
`

const dts = processSource(source)
console.log(dts)
// Output:
// export declare const greeting: string;
// export declare function greet(name: string): string;
```

## Basic Configuration

Create a `dts.config.ts` file in your project root:

```ts
// dts.config.ts
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

## Watch Mode

Watch for changes and regenerate automatically:

```bash
bunx dtsx watch
```

## Stdin/Stdout Processing

Process TypeScript from stdin:

```bash
echo "export const foo: string = 'bar'" | bunx dtsx stdin
```

## Next Steps

- Learn about [Configuration](./configuration.md) options
- Explore [CLI Commands](./cli.md)
- Understand [Isolated Declarations](./isolated-declarations.md)

## Ecosystem Integration

dtsx is used throughout the Stacks ecosystem:

- **[Stacks Framework](https://stacksjs.org)** - Uses dtsx for type generation
- **[clapp](https://clapp.stacksjs.org)** - CLI framework built with dtsx
- **[BunPress](https://bunpress.sh)** - Documentation generator built with dtsx
