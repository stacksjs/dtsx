---
title: CLI Commands
description: Complete reference for dtsx command-line interface.
---

# CLI Commands

dtsx provides a powerful command-line interface for generating TypeScript declaration files.

## Installation

```bash
# Install globally
bun add -g @stacksjs/dtsx

# Or use directly with bunx
bunx dtsx
```

## Commands

### generate

Generate declaration files from TypeScript source.

```bash
dtsx generate [options]
```

#### Options

**Basic Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--cwd <path>` | Working directory | Current directory |
| `--root <path>` | Source root directory | `./src` |
| `--entrypoints <files>` | Entry point files (comma-separated) | `**/*.ts` |
| `--outdir <path>` | Output directory | `./dist` |
| `--keep-comments` | Keep comments in output | `true` |
| `--clean` | Clean output directory first | `false` |
| `--tsconfig <path>` | Path to tsconfig.json | `tsconfig.json` |

**Performance Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--parallel` | Process files in parallel | `false` |
| `--concurrency <n>` | Number of concurrent workers | `4` |

**Output Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--verbose` | Enable verbose output | `false` |
| `--log-level <level>` | Log level (debug, info, warn, error, silent) | `info` |
| `--stats` | Show generation statistics | `false` |
| `--output-format <fmt>` | Output format (text, json) | `text` |
| `--progress` | Show progress during generation | `false` |
| `--diff` | Show diff of changes | `false` |

**Validation Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--validate` | Validate generated .d.ts files | `false` |
| `--continue-on-error` | Continue if a file fails | `false` |
| `--dry-run` | Preview without writing | `false` |

**Filtering Options:**

| Option | Description |
|--------|-------------|
| `--exclude <patterns>` | Glob patterns to exclude (comma-separated) |
| `--import-order <patterns>` | Import order patterns (comma-separated) |

#### Examples

```bash
# Basic generation
dtsx generate

# With custom directories
dtsx generate --root ./lib --outdir ./types

# Parallel processing for large projects
dtsx generate --parallel --concurrency 8

# Preview changes without writing
dtsx generate --dry-run --stats

# Validate generated files
dtsx generate --validate

# Exclude test files
dtsx generate --exclude "**/*.test.ts,**/__tests__/**"

# Custom import ordering
dtsx generate --import-order "node:,bun,@myorg/"

# Full verbose output
dtsx generate --verbose --stats --progress
```

### watch

Watch for file changes and regenerate automatically.

```bash
dtsx watch [options]
```

#### Options

All options from `generate` are supported, plus:

| Option | Description |
|--------|-------------|
| `--debounce <ms>` | Debounce delay in milliseconds |

#### Examples

```bash
# Watch with default options
dtsx watch

# Watch specific directory
dtsx watch --root src --outdir dist/types

# Watch with validation
dtsx watch --validate --verbose
```

### stdin

Process TypeScript from stdin and output declarations to stdout.

```bash
dtsx stdin
```

#### Examples

```bash
# Pipe source code directly
echo "export const foo: string = 'bar'" | dtsx stdin

# Process a file through stdin
cat src/index.ts | dtsx stdin

# Chain with other tools
cat src/utils.ts | dtsx stdin > dist/utils.d.ts

# Process and save
dtsx stdin < src/types.ts > dist/types.d.ts
```

### help

Display help information.

```bash
dtsx --help
dtsx generate --help
dtsx watch --help
```

### version

Display version information.

```bash
dtsx --version
```

## Output Examples

### Text Output (Default)

```
dtsx v1.0.0

Generating declarations...

  src/index.ts → dist/index.d.ts
  src/types.ts → dist/types.d.ts
  src/utils.ts → dist/utils.d.ts

✓ Generated 3 files in 45ms
```

### JSON Output

```bash
dtsx generate --output-format json --stats
```

```json
{
  "filesGenerated": 3,
  "durationMs": 45,
  "files": [
    { "input": "src/index.ts", "output": "dist/index.d.ts" },
    { "input": "src/types.ts", "output": "dist/types.d.ts" },
    { "input": "src/utils.ts", "output": "dist/utils.d.ts" }
  ]
}
```

### Verbose Output

```bash
dtsx generate --verbose --stats
```

```
dtsx v1.0.0

Configuration:
  Root: ./src
  Output: ./dist
  Parallel: false
  Clean: false

Processing files...

[1/3] src/index.ts → dist/index.d.ts (12ms)
[2/3] src/types.ts → dist/types.d.ts (8ms)
[3/3] src/utils.ts → dist/utils.d.ts (10ms)

Statistics:
  Files generated: 3
  Total duration: 45ms
  Average per file: 15ms
```

### Dry Run Output

```bash
dtsx generate --dry-run --diff
```

```
dtsx v1.0.0

Dry run mode - no files will be written

Changes that would be made:

  [CREATE] dist/index.d.ts
  [CREATE] dist/types.d.ts
  [UPDATE] dist/utils.d.ts
    + export declare function newHelper(): void;

Would generate 3 files
```

## Exit Codes

| Code | Description |
|------|-------------|
| `0` | Success |
| `1` | Error occurred |
| `2` | Invalid arguments |

## Integration with Build Tools

### package.json Scripts

```json
{
  "scripts": {
    "build:types": "dtsx generate --clean",
    "build:types:watch": "dtsx watch",
    "build:types:check": "dtsx generate --dry-run --validate"
  }
}
```

### Pre-commit Hook

```bash
# .husky/pre-commit
dtsx generate --validate
```

## Related

- [Getting Started](./getting-started.md) - Installation and setup
- [Configuration](./configuration.md) - Configuration options
- [Isolated Declarations](./isolated-declarations.md) - TypeScript feature
