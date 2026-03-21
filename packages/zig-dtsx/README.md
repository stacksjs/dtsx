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

Benchmarked on Apple M3 Pro, macOS _(bun 1.3.11, arm64-darwin)_.

### In-Process API — No Cache

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **zig-dtsx** | **3.37 µs** | **7.05 µs** | **21.89 µs** | **144.89 µs** |
| oxc-transform | 7.36 µs _(2.2x)_ | 21.91 µs _(3.1x)_ | 89.66 µs _(4.1x)_ | 560.86 µs _(3.9x)_ |
| tsc | 169.69 µs _(50.4x)_ | 410.31 µs _(58.2x)_ | 1.03 ms _(47.1x)_ | 4.02 ms _(27.7x)_ |

### CLI — Single File

| Tool | Small (~50 lines) | Medium (~100 lines) | Large (~330 lines) | XLarge (~1050 lines) |
|------|-------------------|---------------------|--------------------|--------------------|
| **zig-dtsx** | **2.69 ms** | **2.35 ms** | **2.28 ms** | **3.14 ms** |
| oxc | 17.08 ms _(6.3x)_ | 17.12 ms _(7.3x)_ | 17.95 ms _(7.9x)_ | 17.69 ms _(5.6x)_ |
| tsgo | 40.53 ms _(15.1x)_ | 44.10 ms _(18.8x)_ | 44.39 ms _(19.5x)_ | 57.77 ms _(18.4x)_ |
| tsc | 384.25 ms _(142.8x)_ | 407.51 ms _(173.4x)_ | 418.81 ms _(183.7x)_ | 454.74 ms _(144.8x)_ |

### Multi-File Project

| Tool | 50 files | 100 files | 500 files |
|------|----------|-----------|-----------|
| **zig-dtsx** | **18.10 ms** | **31.46 ms** | **~140 ms** |
| oxc | 48.27 ms _(2.7x)_ | 79.00 ms _(2.5x)_ | ~365 ms _(2.6x)_ |
| tsgo | 244.68 ms _(13.5x)_ | 419.65 ms _(13.3x)_ | - |
| tsc | 871.48 ms _(48.1x)_ | - | - |

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
