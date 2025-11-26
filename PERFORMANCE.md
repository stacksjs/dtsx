# dtsx Performance Guide

This guide provides tips and strategies for optimizing dtsx performance when working with large codebases.

## Table of Contents

- [Quick Wins](#quick-wins)
- [Configuration Optimization](#configuration-optimization)
- [Incremental Builds](#incremental-builds)
- [Parallel Processing](#parallel-processing)
- [Memory Management](#memory-management)
- [Build Tool Integration](#build-tool-integration)
- [Benchmarking](#benchmarking)
- [Troubleshooting](#troubleshooting)

## Quick Wins

### 1. Use Entry Points Only

By default, dtsx processes only entry points. This is the fastest approach:

```typescript
await generate({
  entrypoints: ['src/index.ts'], // Only process this file
  // NOT: ['**/*.ts'] which processes everything
})
```

### 2. Enable Incremental Builds

Skip unchanged files with caching:

```bash
dtsx generate --incremental
```

Or programmatically:

```typescript
import { IncrementalCache, createIncrementalBuilder } from '@stacksjs/dtsx'

const cache = new IncrementalCache('.dtsx-cache')
const builder = createIncrementalBuilder(cache, configHash)

// Only processes changed files
const result = await builder.buildFile(filePath, content)
```

### 3. Use Watch Mode Efficiently

Watch mode with debouncing prevents unnecessary rebuilds:

```typescript
import { createWatcher } from '@stacksjs/dtsx'

const watcher = createWatcher({
  root: './src',
  debounce: 300, // Wait 300ms after last change
})
```

### 4. Exclude Unnecessary Files

```typescript
await generate({
  entrypoints: ['src/**/*.ts'],
  exclude: [
    'src/**/*.test.ts',
    'src/**/*.spec.ts',
    'src/__tests__/**',
    'src/__mocks__/**',
  ],
})
```

## Configuration Optimization

### Optimal Config for Large Projects

```typescript
// dtsx.config.ts
import { defineConfig } from '@stacksjs/dtsx'

export default defineConfig({
  // Only process entry points
  entrypoints: ['src/index.ts'],

  // Enable caching
  incremental: true,

  // Skip comments if not needed
  keepComments: false,

  // Don't clean on every build
  clean: false,

  // Use specific tsconfig
  tsconfigPath: 'tsconfig.build.json',
})
```

### Minimal tsconfig for Declarations

Create a `tsconfig.build.json` that only includes what's needed:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src/index.ts"],
  "exclude": ["**/*.test.ts", "**/*.spec.ts"]
}
```

### Skip Library Checks

If type checking external libraries is slow:

```typescript
// In your tsconfig.json
{
  "compilerOptions": {
    "skipLibCheck": true
  }
}
```

## Incremental Builds

### How Caching Works

dtsx caches:
- File content hashes
- Parsed declarations
- Generated output
- Dependency relationships

When a file changes, only files that depend on it are regenerated.

### Setting Up Incremental Builds

```typescript
import { IncrementalCache } from '@stacksjs/dtsx'

// Create cache with custom location
const cache = new IncrementalCache({
  cacheDir: '.dtsx-cache',
  maxAge: 86400000, // 24 hours
})

// Check cache hit ratio
const stats = cache.getStats()
console.log(`Cache hit ratio: ${stats.hitRatio}%`)
```

### Cache Invalidation

The cache automatically invalidates when:
- File content changes
- Configuration changes
- Dependencies change

Force cache clear:

```bash
dtsx generate --clear-cache
```

Or programmatically:

```typescript
await cache.clear()
```

## Parallel Processing

### Worker Pool

For large projects, use worker threads:

```typescript
import { WorkerPool, parallelProcess } from '@stacksjs/dtsx'

// Create a pool of 4 workers
const pool = new WorkerPool({ maxWorkers: 4 })
await pool.init()

// Process files in parallel
const results = await pool.processFiles(files, config)

// Check performance
const stats = pool.getStats()
console.log(`Processed ${stats.tasksCompleted} files`)
console.log(`Average time: ${stats.averageTaskTime}ms`)

// Clean up
await pool.shutdown()
```

### Optimal Worker Count

```typescript
import os from 'node:os'

const cpuCount = os.cpus().length
const optimalWorkers = Math.max(1, cpuCount - 1) // Leave one core free

const pool = new WorkerPool({ maxWorkers: optimalWorkers })
```

### File Batching

Group small files together for efficiency:

```typescript
import { batchFiles, calculateOptimalBatchSize } from '@stacksjs/dtsx'

const files = ['a.ts', 'b.ts', 'c.ts', /* ... */]
const batchSize = calculateOptimalBatchSize(files.length)
const batches = batchFiles(files, batchSize)

for (const batch of batches) {
  await processFileBatch(batch)
}
```

## Memory Management

### Streaming for Large Files

For files larger than 1MB, use streaming:

```typescript
import { StreamingProcessor } from '@stacksjs/dtsx'

const processor = new StreamingProcessor({
  maxMemoryMB: 512,
  chunkSize: 65536, // 64KB chunks
})

// Process file in chunks
await processor.processFileInChunks(
  'large-file.ts',
  async (chunk) => processChunk(chunk),
  1000 // lines per chunk
)
```

### Memory Monitoring

```typescript
import { createStreamingProcessor, formatMemoryStats } from '@stacksjs/dtsx'

const processor = createStreamingProcessor({ profile: true })

// Start monitoring
processor.startMonitoring()

// Do work...
await generate(config)

// Check memory usage
const stats = processor.getMemoryStats()
console.log(formatMemoryStats(stats))

// Stop monitoring
processor.stopMonitoring()
```

### Object Pooling

Reuse objects to reduce GC pressure:

```typescript
import { ObjectPool } from '@stacksjs/dtsx'

const declarationPool = new ObjectPool(
  () => ({ name: '', type: '', content: '' }), // Factory
  (obj) => { obj.name = ''; obj.type = ''; obj.content = '' }, // Reset
  1000 // Max pool size
)

// Get from pool
const declaration = declarationPool.acquire()

// Return to pool when done
declarationPool.release(declaration)
```

## Build Tool Integration

### Vite (Fastest)

```typescript
// vite.config.ts
import { dts } from 'vite-plugin-dtsx'

export default {
  plugins: [
    dts({
      trigger: 'build', // Only on production build
      skipIfUpToDate: true,
    }),
  ],
}
```

### esbuild

```typescript
import { dtsx } from 'esbuild-plugin-dtsx'

await build({
  plugins: [
    dtsx({
      entryPointsOnly: true,
      trigger: 'build',
    }),
  ],
})
```

### tsup

```typescript
// tsup.config.ts
import { dtsxPlugin } from 'tsup-plugin-dtsx'

export default {
  plugins: [
    dtsxPlugin({
      skipIfTsupDts: true,
    }),
  ],
}
```

### webpack

```typescript
// webpack.config.js
const { DtsxWebpackPlugin } = require('webpack-plugin-dtsx')

module.exports = {
  plugins: [
    new DtsxWebpackPlugin({
      trigger: 'afterEmit',
      skipUnchanged: true,
    }),
  ],
}
```

## Benchmarking

### Running Benchmarks

```bash
# Full benchmark suite
bun run benchmark.ts

# Quick benchmark
bun run benchmark.ts --quick

# Skip generation tests
bun run benchmark.ts --skip-generation

# Skip phase timing
bun run benchmark.ts --skip-phases
```

### Understanding Results

```
📊 BENCHMARK SUMMARY
============================================================

Extraction Suite (5000ms total)
--------------------------------------------------
🏆 Simple (0001.ts): 0.15ms
   Medium (0002.ts): 0.45ms
   Complex (0003.ts): 1.23ms
🐢 Very Complex (0005.ts): 3.45ms

⏱️  PHASE TIMING SUMMARY
============================================================

Average Time Distribution:
--------------------------------------------------
Extraction     85.2% ████████████████████████████████████████████
Processing     12.3% ██████
Formatting      2.1% █
File Read       0.4%

💡 Optimization Target:
   Extraction accounts for 85.2% of processing time
```

### Custom Benchmarks

```typescript
import { runBenchmark, generateLargeTypeScriptFile } from '@stacksjs/dtsx'

// Generate test file
const source = generateLargeTypeScriptFile(10000) // 10k lines

// Run benchmark
const result = await runBenchmark(
  'My Test',
  () => extractDeclarations(source, 'test.ts'),
  { warmupIterations: 3, benchmarkIterations: 100 },
  source.length
)

console.log(`Average: ${result.avgTimeMs}ms`)
console.log(`Throughput: ${result.throughputCharsPerSec / 1000}k chars/sec`)
```

## Troubleshooting

### Slow Initial Build

**Problem**: First build is slow
**Solution**: This is normal due to cache warming. Subsequent builds will be faster with `--incremental`.

### High Memory Usage

**Problem**: Memory usage spikes during generation
**Solutions**:
1. Use streaming processor for large files
2. Reduce `maxDeclarationsInMemory` config
3. Process files in smaller batches
4. Enable aggressive GC: `--expose-gc` flag

```typescript
const processor = new StreamingProcessor({
  maxMemoryMB: 256, // Lower limit
  aggressiveGC: true,
})
```

### Cache Not Working

**Problem**: Cache hit ratio is 0%
**Solutions**:
1. Check cache directory permissions
2. Ensure config hash is stable
3. Verify file paths are consistent

```typescript
// Debug cache
const stats = cache.getStats()
console.log('Hits:', stats.hits)
console.log('Misses:', stats.misses)
console.log('Hit ratio:', stats.hitRatio)
```

### Watch Mode Rebuilding Too Often

**Problem**: Rebuilds trigger multiple times per save
**Solution**: Increase debounce time

```typescript
const watcher = createWatcher({
  debounce: 500, // Increase from default 300ms
})
```

### Worker Threads Not Helping

**Problem**: Parallel processing is slower
**Solutions**:
1. Overhead is too high for small files - use single thread
2. Reduce worker count
3. Increase batch size

```typescript
// For small projects, skip workers
if (files.length < 10) {
  await processSequentially(files)
} else {
  await parallelProcess(files, config, { maxWorkers: 2 })
}
```

## Performance Checklist

Before optimizing, verify:

- [ ] Using `--incremental` flag
- [ ] Entry points only (not `**/*.ts`)
- [ ] Excluding test files
- [ ] Using `skipLibCheck` in tsconfig
- [ ] Watch mode has appropriate debounce
- [ ] Cache directory is writable
- [ ] Not running with `--clean` every time

## Performance Targets

| Project Size | Files | Target Time |
|-------------|-------|-------------|
| Small | < 50 | < 1s |
| Medium | 50-200 | < 5s |
| Large | 200-1000 | < 30s |
| Very Large | > 1000 | < 2min |

*Times assume incremental builds with warm cache*

## Getting Help

If you're still experiencing performance issues:

1. Run benchmarks to identify bottleneck
2. Check memory usage with profiling
3. Open an issue with benchmark results
