# zig-dtsx

A high-performance TypeScript declaration file (.d.ts) emitter written in Zig. This is the native companion to the TypeScript-based `@stacksjs/dtsx`, providing the same output with significantly faster execution.

## Overview

`zig-dtsx` reimplements the dtsx declaration generation pipeline in Zig for maximum performance. It produces output identical to the TypeScript implementation and is used as a drop-in replacement when the compiled binary is available.

## Installation

```bash
bun add @stacksjs/zig-dtsx -d
```

## Usage

### As a Library

```typescript
import { processSource, ZIG_AVAILABLE } from '@stacksjs/zig-dtsx'

if (ZIG_AVAILABLE) {
  const dtsOutput = processSource(typescriptSource, true)
  console.log(dtsOutput)
}
```

### Building from Source

Requires [Zig](https://ziglang.org/) to be installed.

```bash
# Build optimized release binary
bun run build:zig

# Build debug binary
bun run build:zig-debug

# Run Zig-native tests
bun run test:zig
```

## Architecture

The Zig implementation mirrors the TypeScript dtsx pipeline:

1. **Scanner** - Tokenizes TypeScript source into a stream of tokens
2. **Extractor** - Parses tokens and extracts declaration-relevant constructs (exports, types, interfaces, classes, functions, variables)
3. **Emitter** - Produces `.d.ts` output from the extracted declarations

The Zig binary communicates with the Node/Bun runtime via FFI, allowing seamless integration with the existing dtsx ecosystem.

## Benchmarks

```bash
bun run benchmark
```

## Testing

Tests validate that the Zig emitter produces identical output to the TypeScript implementation across all shared test fixtures.

```bash
# Run via Bun test runner
bun test

# Run Zig-native tests
zig build test
```

## License

MIT
