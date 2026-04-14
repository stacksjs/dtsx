---
title: Getting Started
description: Learn how to install and use dtsx for TypeScript declaration file generation.
---
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
