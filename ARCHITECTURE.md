# dtsx Architecture Guide

This document describes the internal architecture of dtsx, a modern TypeScript declaration file (.d.ts) generator.

## Overview

dtsx is designed as a modular, pipeline-based system that processes TypeScript source files and generates optimized declaration files. The architecture emphasizes:

- **Performance**: Parallel processing, caching, and incremental builds
- **Extensibility**: Plugin system and transformer hooks
- **Memory Efficiency**: Streaming processing and object pooling

## Core Pipeline

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│   Source    │───▶│  Extractor   │───▶│  Processor  │───▶│  Generator   │
│   Files     │    │              │    │             │    │              │
└─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘
                          │                   │                   │
                          ▼                   ▼                   ▼
                   ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
                   │ Declarations │    │ Transformed │    │    .d.ts     │
                   │    Array     │    │ Declarations│    │    Files     │
                   └──────────────┘    └─────────────┘    └──────────────┘
```

## Module Breakdown

### Entry Points

#### `src/generator.ts`
The main entry point that orchestrates the entire generation process.

```typescript
import { generate } from '@stacksjs/dtsx'

await generate({
  cwd: process.cwd(),
  root: './src',
  outdir: './dist',
  entrypoints: ['**/*.ts'],
})
```

**Key Functions:**
- `generate()` - Main generation function
- `generateFromSource()` - Generate from raw source string
- `processFile()` - Process a single file

### Extraction Layer

#### `src/extractor.ts`
Extracts declarations from TypeScript source code.

**Pipeline:**
```
Source Code → Tokenization → Declaration Detection → AST Analysis → Declaration Objects
```

**Key Functions:**
- `extractDeclarations()` - Extract all declarations from source
- `extractFunctionDeclaration()` - Parse function signatures
- `extractClassDeclaration()` - Parse class definitions
- `extractTypeDeclaration()` - Parse type aliases and interfaces

**Declaration Types:**
```typescript
type DeclarationType =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'enum'
  | 'namespace'
  | 'module'
```

### Processing Layer

#### `src/processor.ts`
Transforms and optimizes extracted declarations.

**Pipeline:**
```
Raw Declarations → Deduplication → Resolution → Optimization → Processed Declarations
```

**Key Operations:**
1. Import resolution
2. Type reference tracking
3. Generic constraint handling
4. Overload merging

#### `src/transformers.ts`
Applies transformations to declarations.

**Built-in Transformers:**
- `removePrivateMembers` - Strip private/internal
- `expandTypeAliases` - Inline type aliases
- `simplifyGenerics` - Simplify generic constraints
- `removeUnusedImports` - Dead code elimination

```typescript
import { createTransformerPipeline } from '@stacksjs/dtsx'

const pipeline = createTransformerPipeline([
  removePrivateMembers(),
  simplifyGenerics(),
])
```

### Output Layer

#### `src/formatter.ts`
Formats the final declaration output.

**Features:**
- Consistent indentation
- Line length management
- Comment preservation
- JSDoc formatting

#### `src/bundler.ts`
Bundles multiple declarations into a single file.

**Modes:**
- Single file bundle
- Per-entry-point bundles
- Namespace-wrapped bundles

### Optimization Modules

#### `src/tree-shaker.ts`
Removes unused type declarations.

```
Build Dependency Graph → Mark Used Types → Remove Unused → Output
```

**Algorithm:**
1. Start with entry point exports
2. Traverse type references
3. Mark all reachable types
4. Remove unreachable declarations

#### `src/merger.ts`
Merges compatible declarations.

**Mergeable Types:**
- Interface declarations (same name)
- Namespace declarations
- Enum declarations (with care)

#### `src/import-sorter.ts`
Organizes and deduplicates imports.

**Sort Order:**
1. Built-in modules (`node:*`)
2. External packages
3. Internal aliases
4. Relative imports
5. Side-effect imports

### Caching & Performance

#### `src/cache.ts`
File-based caching for incremental builds.

**Cache Keys:**
- File content hash
- Config hash
- Dependency hashes

```typescript
interface CacheEntry {
  contentHash: string
  configHash: string
  declarations: Declaration[]
  dtsContent: string
  dependencies: string[]
  timestamp: number
}
```

#### `src/incremental.ts`
Incremental build support with dependency tracking.

**Features:**
- Content-based invalidation
- Dependency graph tracking
- Partial regeneration

#### `src/memory.ts`
Memory optimization utilities.

**Components:**
- `StreamingProcessor` - Large file handling
- `DeclarationPool` - WeakRef-based pooling
- `StringInterner` - String deduplication
- `ObjectPool` - Reusable object instances

#### `src/worker.ts`
Worker thread parallelization.

```typescript
import { WorkerPool, parallelProcess } from '@stacksjs/dtsx'

const pool = new WorkerPool({ maxWorkers: 4 })
await pool.init()

const results = await pool.processFiles(files, config)
```

### Tooling Integration

#### `src/watcher.ts`
File watching for development mode.

**Features:**
- Debounced regeneration
- Change detection
- Selective rebuilds

#### `src/lsp.ts`
Language Server Protocol support.

**Capabilities:**
- Hover information
- Go to definition
- Find references
- Rename symbol
- Code actions
- Formatting

#### `src/sourcemap.ts`
Source map generation.

**Features:**
- VLQ encoding
- Source content embedding
- Bi-directional mapping

### Analysis & Diagnostics

#### `src/checker.ts`
Type checking and validation.

**Checks:**
- Missing type references
- Circular dependencies
- Invalid generics
- Export consistency

#### `src/diff.ts`
Declaration diff generation.

**Use Cases:**
- API change detection
- Breaking change analysis
- Version comparison

#### `src/docs.ts`
Documentation generation.

**Formats:**
- Markdown
- JSON
- TypeDoc-compatible

### Plugin System

#### `src/plugins.ts`
Extensibility through plugins.

```typescript
interface DtsxPlugin {
  name: string

  // Lifecycle hooks
  onConfig?(config: Config): Config
  onExtract?(declarations: Declaration[]): Declaration[]
  onTransform?(declaration: Declaration): Declaration
  onOutput?(content: string): string

  // Custom transformers
  transformers?: Transformer[]
}
```

**Plugin Example:**
```typescript
const myPlugin: DtsxPlugin = {
  name: 'my-plugin',

  onExtract(declarations) {
    return declarations.filter(d => !d.name.startsWith('_'))
  },
}
```

## Data Flow

### Declaration Structure

```typescript
interface Declaration {
  name: string
  type: DeclarationType
  content: string
  start: number
  end: number
  isExported: boolean

  // Optional metadata
  jsdoc?: string
  generics?: string[]
  extends?: string[]
  implements?: string[]
  modifiers?: string[]
}
```

### Configuration

```typescript
interface DtsGenerationConfig {
  // Paths
  cwd: string
  root: string
  outdir: string
  entrypoints: string[]

  // Options
  clean?: boolean
  keepComments?: boolean
  tsconfigPath?: string

  // Processing
  transformers?: Transformer[]
  plugins?: DtsxPlugin[]

  // Output
  bundleDeclarations?: boolean
  declarationMap?: boolean
}
```

## Build Tool Integrations

### Vite Plugin (`vite-plugin-dtsx`)

```typescript
import { dts } from 'vite-plugin-dtsx'

export default {
  plugins: [
    dts({
      trigger: 'build',
      hmr: true,
    }),
  ],
}
```

### esbuild Plugin (`esbuild-plugin-dtsx`)

```typescript
import { dtsx } from 'esbuild-plugin-dtsx'

await build({
  plugins: [
    dtsx({
      entryPointsOnly: true,
    }),
  ],
})
```

### Bun Plugin (`bun-plugin-dtsx`)

```typescript
import dts from 'bun-plugin-dtsx'

await Bun.build({
  plugins: [dts()],
})
```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Extraction | O(n) | Linear with file size |
| Tree Shaking | O(n * m) | n=declarations, m=deps |
| Merging | O(n log n) | Sorting + merging |
| Bundling | O(n) | Linear combination |

### Memory Usage

| Component | Strategy | Notes |
|-----------|----------|-------|
| Large Files | Streaming | Chunk-based processing |
| Declarations | WeakRef Pool | Automatic cleanup |
| Strings | Interning | Deduplication |
| Objects | Pool | Reuse instances |

### Caching Impact

| Scenario | Without Cache | With Cache |
|----------|---------------|------------|
| Full Build | 100% | 100% |
| No Changes | 100% | ~5% |
| Single File | 100% | ~10% |
| 10% Changed | 100% | ~15% |

## Error Handling

### Error Types

```typescript
class DtsxError extends Error {
  code: string
  file?: string
  line?: number
  column?: number
}

// Specific errors
class ParseError extends DtsxError { code = 'PARSE_ERROR' }
class ResolutionError extends DtsxError { code = 'RESOLUTION_ERROR' }
class ValidationError extends DtsxError { code = 'VALIDATION_ERROR' }
```

### Recovery Strategies

1. **Parse Errors**: Skip problematic declaration, continue processing
2. **Resolution Errors**: Use `any` type placeholder
3. **Validation Errors**: Emit warning, generate anyway

## Testing Strategy

### Unit Tests
- Individual function testing
- Parser edge cases
- Transformer correctness

### Integration Tests
- Full pipeline testing
- Fixture-based comparison
- Snapshot testing

### Performance Tests
- Benchmark suite
- Memory profiling
- Regression detection

## Future Architecture

### Planned Improvements

1. **Incremental Parsing**: Only re-parse changed portions
2. **Parallel Extraction**: Multi-threaded file reading
3. **Smart Caching**: Content-addressable storage
4. **WASM Core**: Performance-critical paths in Rust/WASM

### Extension Points

1. **Custom Parsers**: Support for non-TS syntax
2. **Output Formats**: JSON Schema, GraphQL, etc.
3. **IDE Plugins**: VSCode, WebStorm extensions
