# Install

Installing `dtsx` is easy. Simply pull it in via your package manager of choice, or download the binary directly.

## Package Managers

Choose your package manager of choice:

::: code-group

```sh [npm]
npm install --save-dev @dtsx/dtsx
# npm i -d @dtsx/dtsx

# or, install globally via
npm i -g @dtsx/dtsx
```

```sh [bun]
bun install --dev @dtsx/dtsx
# bun add --dev @dtsx/dtsx
# bun i -d @dtsx/dtsx

# or, install globally via
bun add --global @dtsx/dtsx
```

```sh [pnpm]
pnpm add --save-dev @dtsx/dtsx
# pnpm i -d @dtsx/dtsx

# or, install globally via
pnpm add --global @dtsx/dtsx
```

```sh [yarn]
yarn add --dev @dtsx/dtsx
# yarn i -d @dtsx/dtsx

# or, install globally via
yarn global add @dtsx/dtsx
```

```sh [brew]
brew install dtsx # coming soon
```

```sh [pkgx]
pkgx dtsx # coming soon
```

:::

::: tip Coming from `@stacksjs/dtsx`?
dtsx was published as `@stacksjs/dtsx` up to v0.11.36. Swap the package for `@dtsx/dtsx` and update your imports — see [Migrating from @stacksjs/dtsx](./MIGRATION.md#from-stacksjsdtsx).
:::

Read more about how to use it in the Usage section of the documentation.

## Binaries

Choose the binary that matches your platform and architecture:

::: code-group

```sh [macOS (arm64)]
# Download the binary
curl -L https://github.com/stacksjs/dtsx/releases/download/v0.8.3/dtsx-darwin-arm64 -o dtsx

# Make it executable
chmod +x dtsx

# Move it to your PATH
mv dtsx /usr/local/bin/dtsx
```

```sh [macOS (x64)]
# Download the binary
curl -L https://github.com/stacksjs/dtsx/releases/download/v0.8.3/dtsx-darwin-x64 -o dtsx

# Make it executable
chmod +x dtsx

# Move it to your PATH
mv dtsx /usr/local/bin/dtsx
```

```sh [Linux (arm64)]
# Download the binary
curl -L https://github.com/stacksjs/dtsx/releases/download/v0.8.3/dtsx-linux-arm64 -o dtsx

# Make it executable
chmod +x dtsx

# Move it to your PATH
mv dtsx /usr/local/bin/dtsx
```

```sh [Linux (x64)]
# Download the binary
curl -L https://github.com/stacksjs/dtsx/releases/download/v0.8.3/dtsx-linux-x64 -o dtsx

# Make it executable
chmod +x dtsx

# Move it to your PATH
mv dtsx /usr/local/bin/dtsx
```

```sh [Windows (x64)]
# Download the binary
curl -L https://github.com/stacksjs/dtsx/releases/download/v0.8.3/dtsx-windows-x64.exe -o dtsx.exe

# Move it to your PATH (adjust the path as needed)
move dtsx.exe C:\Windows\System32\dtsx.exe
```

:::

::: tip
You can also find the `dtsx` binaries in GitHub [releases](https://github.com/stacksjs/dtsx/releases).
:::

## Verification

After installation, verify that dtsx is working correctly:

```bash
# Check version
dtsx --version

# Show help
dtsx --help

# Test generation (in a TypeScript project)
dtsx --verbose
```

## Requirements

### System Requirements

- **Node.js**: Version 18 or higher (for npm package)
- **Bun**: Latest version recommended (for optimal performance)
- **TypeScript**: Version 5.0 or higher

### Project Requirements

For optimal performance, you can optionally enable `isolatedDeclarations` in `tsconfig.json`. dtsx works great without it — it infers narrow types directly from your source values:

```json
{
  "compilerOptions": {
    "isolatedDeclarations": true, // optional fast path
    "declaration": true
  }
}
```

## Troubleshooting

### Common Issues

1. **Permission Denied (Binary Installation)**

    ```bash
# Make sure the binary is executable
   chmod +x dtsx
    ```

2. **Command Not Found**

    ```bash
# Ensure the binary is in your PATH
   echo $PATH
   which dtsx
    ```

3. **TypeScript Errors**

    ```bash
# dtsx works without isolatedDeclarations
# Check your source files for syntax errors
    ```

### Getting Help

If you encounter issues:

1. Check the [troubleshooting guide](./advanced/troubleshooting.md)
2. Search existing [GitHub issues](https://github.com/stacksjs/dtsx/issues)
3. Create a new issue with reproduction steps
4. Join our [Discord community](https://stacksjs.com/discord)

## Next Steps

After installation, check out:

- [Usage Guide](./usage.md) - Learn how to use dtsx
- [Configuration](./config.md) - Customize dtsx for your project
- [API Reference](./api-reference.md) - Detailed API documentation
- [Features](./features/) - Explore advanced features
