# Troubleshooting Guide

This guide covers common issues and their solutions when using dtsx.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Configuration Issues](#configuration-issues)
- [Generation Issues](#generation-issues)
- [Output Issues](#output-issues)
- [Performance Issues](#performance-issues)
- [Build Tool Integration](#build-tool-integration)
- [Type-Specific Issues](#type-specific-issues)
- [CLI Issues](#cli-issues)
- [Getting Help](#getting-help)

## Installation Issues

### Bun Not Found

**Error**: `bun: command not found`

**Solution**: Install Bun first:
```bash
curl -fsSL https://bun.sh/install | bash
```

### Peer Dependency Warnings

**Warning**: `WARN unmet peer dependency`

**Solution**: These are usually optional. For build tool plugins, install the required peer:
```bash
# For Vite plugin
bun add vite -d

# For webpack plugin
bun add webpack -d

# For tsup plugin
bun add tsup -d
```

### TypeScript Version Mismatch

**Error**: `Cannot find module 'typescript'`

**Solution**: Ensure TypeScript is installed:
```bash
bun add typescript -d
```

## Configuration Issues

### Config File Not Found

**Error**: `Could not find dtsx.config.ts`

**Solution**: Create the config file or use CLI flags:
```bash
# Use CLI flags instead
dtsx generate --root ./src --outdir ./dist

# Or create config
touch dtsx.config.ts
```

### Invalid Configuration

**Error**: `Invalid configuration option`

**Solution**: Check the config schema:
```typescript
// dtsx.config.ts
import { defineConfig } from '@stacksjs/dtsx'

export default defineConfig({
  // Valid options:
  cwd: process.cwd(),
  root: './src',
  outdir: './dist',
  entrypoints: ['index.ts'],
  tsconfigPath: 'tsconfig.json',
  clean: false,
  keepComments: true,
})
```

### TSConfig Not Found

**Error**: `Cannot find tsconfig.json`

**Solution**:
1. Create a tsconfig.json:
```bash
bunx tsc --init
```

2. Or specify path explicitly:
```typescript
export default defineConfig({
  tsconfigPath: './config/tsconfig.build.json',
})
```

### Path Aliases Not Resolving

**Error**: `Cannot resolve module '@/utils'`

**Solution**: Ensure paths are in tsconfig:
```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

Then reference the tsconfig:
```typescript
export default defineConfig({
  tsconfigPath: 'tsconfig.json',
})
```

## Generation Issues

### No Output Generated

**Problem**: Running dtsx produces no files

**Solutions**:

1. Check entrypoints exist:
```typescript
export default defineConfig({
  entrypoints: ['src/index.ts'], // Make sure this file exists
})
```

2. Check for glob pattern issues:
```typescript
// Wrong - file extension missing
entrypoints: ['src/index']

// Correct
entrypoints: ['src/index.ts']
```

3. Enable verbose mode:
```bash
dtsx generate --verbose
```

### Empty Declaration Files

**Problem**: Generated `.d.ts` files are empty

**Solutions**:

1. Ensure exports exist:
```typescript
// src/index.ts
export function myFunction() {} // Must have 'export'
```

2. Check for export errors:
```bash
dtsx generate --validate
```

3. Verify the file is being processed:
```bash
dtsx generate --verbose --stats
```

### Missing Exports

**Problem**: Some exports are missing from output

**Solutions**:

1. Check export syntax:
```typescript
// These all work:
export function foo() {}
export const bar = 1
export type Baz = string
export { qux } from './other'
export * from './module'
```

2. Check for circular dependencies:
```bash
dtsx check --circular
```

3. Ensure re-exports are included:
```typescript
// src/index.ts
export * from './utils'  // Make sure this is present
export * from './types'
```

### Duplicate Declarations

**Problem**: Same declaration appears multiple times

**Solution**: Use the merger:
```typescript
import { mergeDeclarations } from '@stacksjs/dtsx'

// Or enable in config
export default defineConfig({
  plugins: [{
    name: 'dedupe',
    onDeclarations(declarations) {
      return mergeDeclarations(declarations)
    }
  }]
})
```

## Output Issues

### Wrong Output Directory

**Problem**: Files generated in wrong location

**Solution**: Check outdir is absolute or relative to cwd:
```typescript
export default defineConfig({
  cwd: process.cwd(),
  outdir: './dist', // Relative to cwd
  // OR
  outdir: '/absolute/path/dist', // Absolute path
})
```

### Missing Type References

**Problem**: Generated types reference missing types

**Solutions**:

1. Add triple-slash references:
```typescript
/// <reference types="node" />
```

2. Include ambient declarations:
```typescript
export default defineConfig({
  entrypoints: [
    'src/index.ts',
    'src/ambient.d.ts', // Include .d.ts files
  ],
})
```

### Incorrect Import Paths

**Problem**: Imports in `.d.ts` have wrong paths

**Solution**: Check module resolution:
```json
// tsconfig.json
{
  "compilerOptions": {
    "moduleResolution": "bundler", // or "node"
  }
}
```

### Comments Not Preserved

**Problem**: JSDoc comments missing from output

**Solution**: Enable comment preservation:
```typescript
export default defineConfig({
  keepComments: true, // Default is true
})
```

### Formatting Issues

**Problem**: Output has inconsistent formatting

**Solution**: Use the formatter:
```bash
dtsx generate --format

# Or specify style
dtsx generate --indent-style spaces --indent-size 2
```

## Performance Issues

### Slow Generation

**Problem**: Generation takes too long

**Solutions**:

1. Use entry points only:
```typescript
export default defineConfig({
  entrypoints: ['src/index.ts'], // Not ['src/**/*.ts']
})
```

2. Enable incremental builds:
```bash
dtsx generate --incremental
```

3. Exclude test files:
```typescript
export default defineConfig({
  exclude: ['**/*.test.ts', '**/*.spec.ts'],
})
```

4. Use parallel processing:
```bash
dtsx generate --parallel --concurrency 4
```

See [PERFORMANCE.md](./PERFORMANCE.md) for detailed optimization tips.

### High Memory Usage

**Problem**: Process runs out of memory

**Solutions**:

1. Increase Node memory:
```bash
NODE_OPTIONS="--max-old-space-size=4096" dtsx generate
```

2. Use streaming for large files:
```typescript
import { StreamingProcessor } from '@stacksjs/dtsx'

const processor = new StreamingProcessor({
  maxMemoryMB: 512,
})
```

3. Process in batches:
```typescript
export default defineConfig({
  batchSize: 50, // Process 50 files at a time
})
```

### Cache Not Working

**Problem**: Incremental builds aren't faster

**Solutions**:

1. Check cache directory exists and is writable:
```bash
ls -la .dtsx-cache
```

2. Verify cache is being used:
```bash
dtsx generate --incremental --verbose
# Look for "Cache hit" messages
```

3. Clear corrupted cache:
```bash
dtsx generate --clear-cache
```

## Build Tool Integration

### Vite Plugin Not Running

**Problem**: vite-plugin-dtsx doesn't generate files

**Solutions**:

1. Check trigger setting:
```typescript
// vite.config.ts
dts({
  trigger: 'build', // Only runs on 'vite build'
  // Use 'serve' for dev, 'both' for all
})
```

2. Verify plugin is loaded:
```typescript
// vite.config.ts
export default {
  plugins: [
    dts(), // Must be in plugins array
  ],
}
```

### webpack Plugin Errors

**Problem**: webpack-plugin-dtsx throws errors

**Solutions**:

1. Check webpack version compatibility:
```json
// package.json - requires webpack 4 or 5
"peerDependencies": {
  "webpack": "^4.0.0 || ^5.0.0"
}
```

2. Verify entry points:
```javascript
// webpack.config.js
module.exports = {
  entry: './src/index.ts', // Must be TypeScript
}
```

### tsup Plugin Conflicts

**Problem**: Both tsup dts and dtsx running

**Solution**: Disable tsup's built-in dts:
```typescript
// tsup.config.ts
export default {
  dts: false, // Disable tsup dts
  plugins: [dtsxPlugin()],
}
```

### esbuild Plugin Not Generating

**Problem**: esbuild-plugin-dtsx produces no output

**Solution**: Check trigger and entry points:
```typescript
dtsx({
  trigger: 'build', // or 'both' for watch mode
  entryPointsOnly: true,
})
```

## Type-Specific Issues

### Generic Types Not Working

**Problem**: Generic types lose type parameters

**Example**:
```typescript
// Input
export function identity<T>(value: T): T { return value }

// Wrong output
export function identity(value: any): any

// Correct output
export declare function identity<T>(value: T): T
```

**Solution**: Ensure generics are explicitly typed:
```typescript
// Add explicit type annotations
export function identity<T>(value: T): T {
  return value
}
```

### Conditional Types Simplified

**Problem**: Complex conditional types become `any`

**Solution**: Use explicit type aliases:
```typescript
// Instead of inline conditional
export function foo(): T extends string ? number : boolean

// Define the type separately
type FooReturn<T> = T extends string ? number : boolean
export function foo<T>(): FooReturn<T>
```

### Mapped Types Issues

**Problem**: Mapped types not preserved correctly

**Solution**: Check for modifier preservation:
```typescript
// These should be preserved:
type Readonly<T> = { readonly [K in keyof T]: T[K] }
type Optional<T> = { [K in keyof T]?: T[K] }
type Mutable<T> = { -readonly [K in keyof T]: T[K] }
```

### Class Decorators

**Problem**: Decorated classes have wrong types

**Solution**: Enable experimental decorators:
```json
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

### Enum Issues

**Problem**: Const enums not emitted correctly

**Solution**: Check tsconfig settings:
```json
// tsconfig.json
{
  "compilerOptions": {
    "preserveConstEnums": true
  }
}
```

## CLI Issues

### Command Not Found

**Error**: `dtsx: command not found`

**Solutions**:

1. Install globally:
```bash
bun add -g @stacksjs/dtsx
```

2. Or use npx/bunx:
```bash
bunx dtsx generate
```

3. Or add to package.json scripts:
```json
{
  "scripts": {
    "build:types": "dtsx generate"
  }
}
```

### Invalid Arguments

**Error**: `Unknown option: --foo`

**Solution**: Check available options:
```bash
dtsx generate --help
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | All files failed |
| 2 | Partial failure |

Check exit code:
```bash
dtsx generate
echo $?
```

### Stdin Not Working

**Problem**: Piping to dtsx doesn't work

**Solution**: Use the stdin command:
```bash
cat src/index.ts | dtsx stdin
```

## Getting Help

### Debug Mode

Enable verbose output:
```bash
dtsx generate --verbose --debug
```

### Check Version

```bash
dtsx --version
```

### Validate Setup

```bash
dtsx check
```

### Report Issues

When reporting issues, include:

1. dtsx version: `dtsx --version`
2. Bun version: `bun --version`
3. OS and version
4. Minimal reproduction
5. Expected vs actual output
6. Config file contents

Open issues at: https://github.com/stacksjs/dtsx/issues

### Community Support

- [GitHub Discussions](https://github.com/stacksjs/dtsx/discussions)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/dtsx)

## Quick Reference

### Common Fixes

| Problem | Quick Fix |
|---------|-----------|
| No output | Check entrypoints exist |
| Empty files | Add exports to source |
| Slow builds | Use `--incremental` |
| Memory issues | Use `--batch-size 50` |
| Wrong paths | Check tsconfig paths |
| Missing types | Add to entrypoints |
| Cache issues | Use `--clear-cache` |

### Useful Commands

```bash
# Generate with all checks
dtsx generate --validate --verbose

# Clear cache and regenerate
dtsx generate --clear-cache

# Check for issues
dtsx check

# Show statistics
dtsx generate --stats

# Dry run (no output)
dtsx generate --dry-run
```
