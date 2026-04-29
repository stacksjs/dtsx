---
title: CLI Commands
description: Complete reference for dtsx command-line interface.
---

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

+ [Getting Started](./getting-started.md) - Installation and setup
+ [Configuration](./configuration.md) - Configuration options
+ [Isolated Declarations](./isolated-declarations.md) - TypeScript feature
