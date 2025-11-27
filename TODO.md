# dtsx - Comprehensive TODO List

> A thorough analysis of improvements, fixes, and features for the DTS generation tool.
> This document is organized by priority and category for iterative development.

### Summary: ~140 tasks across 18 categories

| Category | Count | Priority |
|----------|-------|----------|
| Critical Performance | 8 | P0/P1 |
| Missing TS Features | 22 | P1 |
| Code Quality & Bugs | 18 | P1/P2 |
| Architecture | 12 | P2 |
| Features | 16 | P2/P3 |
| Plugin Ecosystem | 10 | P2 |
| Doc vs Implementation | 10 | P1 |
| ESLint Tech Debt | 5 | P2 |
| CLI Improvements | 9 | P2 |
| Type Inference Edge Cases | 5 | P1 |
| Package/Distribution | 6 | P2 |
| Test Coverage | 7 | P1 |
| Concurrency | 5 | P2 |
| Output Quality | 6 | P3 |
| Security | 5 | P2 |

---

## 🔴 Critical Performance Issues

### P0: Memory & Algorithmic Efficiency

- [x] **Regex compilation caching** - `processor.ts` creates new RegExp objects inside loops. Pre-compile and cache these patterns. ✅ Implemented module-level caching

  ```typescript
  // Fixed: INTERFACE_PATTERN, TYPE_PATTERN, CLASS_PATTERN, ENUM_PATTERN at module level
  // Also cached interface patterns in extractor/helpers.ts
  ```

- [x] **O(n²) import usage detection** - `processDeclarations()` iterates over all imports for every declaration type. ✅ Refactored to combine all texts and do single-pass search

  ```typescript
  // Fixed: Combine all declaration texts, single regex test per import name
  ```

- [x] **Redundant `extractAllImportedItems()` calls** - Called multiple times for the same import. ✅ Already cached via `getImportItemsFromCache()`

- [x] **String concatenation in hot paths** - `processor.ts` uses string concatenation (`result +=`) extensively. Use array joins for better performance. ✅ Refactored to use array `.join()` pattern in builders.ts

- [x] **Repeated source code parsing** - `extractDeclarations()` creates a new SourceFile for each file. Consider caching parsed ASTs when processing related files. ✅ AST caching exists in extractor/cache.ts

### P1: Parser Efficiency

- [ ] **Avoid double-parsing** - `parser.ts` and `extractor.ts` both parse similar constructs. Consolidate into a single AST-based approach.

- [x] **Lazy comment extraction** - `extractJSDocComments()` is called even when `keepComments=false`. Short-circuit early. ✅ Already implemented

- [ ] **Reduce regex backtracking** - Multiple regexes in `processor.ts` have super-linear backtracking (noted by eslint-disable comments). Rewrite with non-backtracking patterns.

---

## 🟠 Missing TypeScript Features

### Type System Support

- [x] **Conditional types with `infer`** - ✅ Working correctly, including nested infer patterns

- [x] **Template literal types** - `inferTemplateLiteralType()` returns `string` for complex cases. Should preserve template literal type syntax. ✅ Working correctly

  ```typescript
  // Input: type Route = `/${string}/${number}`
  // Output: `/${string}/${number}` (preserved correctly)
  ```

- [x] **Mapped type modifiers** - ✅ `+readonly`, `-readonly`, `+?`, `-?` modifiers preserved

- [x] **`satisfies` operator** - ✅ Working via `extractSatisfiesType()`

- [x] **`const` type parameters** - ✅ TypeScript 5.0+ feature working

  ```typescript
  function foo<const T>(x: T): T  // Works!
  ```

- [x] **Variadic tuple types** - ✅ `[...T]` spread in tuple types working

- [x] **Named tuple elements** - ✅ `[first: string, second: number]` working

- [x] **`NoInfer<T>` utility type** - ✅ TypeScript 5.4+ feature working

### Declaration Support

- [x] **Function overloads** - ✅ Working correctly

- [x] **Ambient module declarations** - ✅ `declare module 'x'` working

- [x] **Global augmentations** - ✅ `declare global { }` blocks working

- [x] **Triple-slash directives** - `/// <reference types="..." />` should be preserved. ✅ Implemented in `extractTripleSlashDirectives()`

- [x] **`declare const enum`** - ✅ Const enums properly emitted

- [x] **Accessor declarations** - ✅ `get`/`set` accessors working

- [x] **Index signatures** - ✅ `[key: string]: T` working

- [x] **Constructor signatures** - ✅ `new (): T` working

- [x] **Call signatures** - ✅ `(): T` working

- [x] **`this` parameter types** - ✅ `function foo(this: SomeType, ...)` working

- [x] **`asserts` return type** - ✅ `asserts x is string` working

- [x] **`is` type predicates** - ✅ `x is string` working

### Module System

- [x] **Dynamic imports** - ✅ `import('module')` type expressions working

- [x] **`import.meta`** - ✅ Type declarations for import.meta properties supported via interface declarations.

- [x] **`export * as ns from`** - ✅ Namespace re-exports working

- [x] **Side-effect imports** - ✅ Preserved (checked in processor)

---

## 🟡 Code Quality & Correctness

### Bug Fixes

- [x] **Duplicate `declare` keywords** - Some outputs may have `export declare declare`. Add deduplication. ✅ Not an issue (verified)

- [x] **Missing semicolons** - Inconsistent semicolon handling in various declaration types. ✅ Fixed in `processTypeDeclaration()`

- [x] **Import alias handling** - `import { X as Y }` aliases may not be tracked correctly through re-exports. ✅ Working correctly

- [x] **Type-only vs value imports** - `import type` vs `import` distinction needs more robust handling for re-exports. ✅ Enhanced in `src/processor/imports.ts`:
  - `ImportItem` interface with `isTypeOnly` property for each item
  - `ParsedImport` interface with detailed parsing results
  - `parseImportDetailed()` - Parse imports with type-only status for each item
  - `parseExportDetailed()` - Parse exports with type-only status
  - `mergeImports()` - Merge value and type imports from same module
  - Handles inline type specifiers: `import { type X, Y }`
  - Added test fixture `test/fixtures/input/type-only-imports.ts`

- [x] **Circular type references** - No detection or handling of circular type dependencies. ✅ Implemented in `src/circular.ts`:
  - `buildDependencyGraph()` - Build import/export dependency graph
  - `detectCircularDependencies()` - Find cycles using DFS
  - `analyzeCircularDependencies()` - Full analysis with results
  - `formatCircularAnalysis()` - Human-readable output
  - Severity levels: 'error' for type cycles, 'warning' for value cycles
  - Graph utilities: `findAllDependents()`, `findAllDependencies()`
  - Export formats: DOT (Graphviz), JSON

- [x] **Generic constraint preservation** - Ensure `<T extends U>` constraints are fully preserved. ✅ Working correctly

- [x] **Default type parameters** - `<T = DefaultType>` may not be handled correctly. ✅ Working correctly

### Type Inference Improvements

- [x] **`as const` nested objects** - ✅ Deep readonly inference for nested `as const` assertions.
  - Detects `as const` assertions in variable declarations
  - Infers `typeof X as const` for objects
  - Infers `readonly [...]` for arrays
  - Preserves literal types for primitives

- [x] **Computed property names** - ✅ `{ [key]: value }` type inference.
  - Handles computed property names in interfaces
  - Handles computed property names in classes
  - Preserves bracket notation in output

- [x] **Symbol property keys** - ✅ `{ [Symbol.iterator]: ... }` handling.
  - Handles Symbol.iterator, Symbol.toStringTag, Symbol.dispose, etc.
  - Works in both interfaces and classes
  - Properly formats generator methods with symbols (`*[Symbol.iterator]()`)

- [x] **Private class fields** - ✅ `#privateField` syntax.
  - Private fields (#field) are excluded from .d.ts output
  - Private methods (#method) are excluded from output
  - Private accessors (get #x, set #x) are excluded from output
  - Private static fields are excluded from output

- [x] **Static blocks** - ✅ `static { }` in classes.
  - Static initialization blocks are excluded from .d.ts output
  - Multiple static blocks handled correctly
  - Static properties are preserved

- [x] **`using` declarations** - ✅ TypeScript 5.2+ explicit resource management.
  - Classes implementing Disposable/AsyncDisposable work correctly
  - Symbol.dispose and Symbol.asyncDispose handled in declarations
  - Disposable interface declarations supported

### Edge Cases

- [ ] **Empty files** - Handle files with no exports gracefully.

- [ ] **Re-export only files** - Files that only re-export from other modules.

- [ ] **Barrel files** - Optimize handling of `index.ts` barrel exports.

- [ ] **Very long lines** - Handle extremely long type definitions without truncation.

- [ ] **Unicode identifiers** - Support non-ASCII identifiers in declarations.

---

## 🟢 Architecture & Design

### Code Organization

- [ ] **Split `processor.ts`** - At 1847 lines, this file is too large. Split into:
  - `processor/imports.ts` - Import processing logic
  - `processor/declarations.ts` - Declaration processing
  - `processor/inference.ts` - Type inference logic
  - `processor/formatting.ts` - Output formatting

- [ ] **Split `extractor.ts`** - At 1375 lines, split into:
  - `extractor/declarations.ts` - Declaration extraction
  - `extractor/signatures.ts` - Signature building
  - `extractor/comments.ts` - Comment extraction

- [ ] **Remove dead code** - `parser.ts` appears to have overlapping functionality with `extractor.ts`. Consolidate or remove.

- [ ] **Consistent error handling** - Add proper error types and error boundaries.

- [ ] **Logging abstraction** - Replace `console.log` with a proper logging system that respects verbosity levels.

### Type Safety

- [ ] **Strict null checks** - Ensure all optional chaining is necessary and correct.

- [x] **Exhaustive switch statements** - Add `never` checks to all switch statements for declaration kinds. ✅ Added `assertNever()` helper and exhaustive checks

- [ ] **Branded types** - Consider using branded types for file paths, source code strings, etc.

### Testing

- [x] **Add missing test for example 0012** - Test file exists but not in test array. ✅ Already included

- [ ] **Add `checker.ts` test** - Large file excluded from tests, should have coverage.

- [x] **Property-based testing** - ✅ Added `test/fuzzing.test.ts` with 25 tests:
  - Random declaration generators (functions, interfaces, types, classes, enums)
  - Malformed input resilience tests (unclosed braces, invalid syntax)
  - Stress tests (many declarations, deep nesting)
  - Performance characteristics tests

- [ ] **Snapshot testing** - Add snapshot tests for complex type transformations.

- [ ] **Error case testing** - Test malformed input handling.

- [ ] **Performance regression tests** - Add benchmarks to CI.

---

## 🔵 Features & Enhancements

### Configuration

- [ ] **`isolatedDeclarations` mode** - `checkIsolatedDeclarations()` exists but isn't used to change behavior. Implement strict mode.

- [ ] **Custom type mappings** - Allow users to specify type replacements.

- [x] **Exclude patterns** - Add glob patterns for excluding files. ✅ Implemented `--exclude` CLI option

- [ ] **Include patterns** - More granular control over what gets processed.

- [x] **Source maps** - Generate source maps for debugging. ✅ Implemented with VLQ encoding

- [x] **Watch mode** - File watching for incremental regeneration. ✅ Implemented `dtsx watch` command

- [x] **Incremental builds** - Cache and reuse unchanged declarations. ✅ Implemented in `src/cache.ts` with content hashing

### Output Quality

- [x] **Prettier integration** - Option to format output with Prettier. ✅ Implemented in `src/formatter.ts`

- [x] **Configurable indentation** - Tabs vs spaces, indent size. ✅ Added `--indent-style` and `--indent-size` CLI options

- [x] **Import sorting** - Configurable import organization. ✅ Implemented in `src/import-sorter.ts` with presets (default, node, bun, typeSeparated, alphabetical)

- [x] **Declaration merging** - Merge related declarations when appropriate. ✅ Implemented in `src/merger.ts` with support for interfaces, namespaces, enums, type aliases

- [x] **Tree shaking** - Remove unused internal types from output. ✅ Implemented in `src/tree-shaker.ts` with dependency graph analysis

### Developer Experience

- [x] **Better error messages** - Include file location and context in errors. ✅ Implemented in `src/errors.ts`

- [x] **Progress reporting** - Show progress for large codebases. ✅ Implemented `--progress` CLI option

- [x] **Diff output** - Show what changed between generations. ✅ Implemented in `src/diff.ts`

- [x] **Validation mode** - Check generated .d.ts files against TypeScript compiler. ✅ Implemented `--validate` flag with error counting

- [x] **IDE integration** - Language server protocol support. ✅ Implemented `src/lsp.ts` with hover, completion, diagnostics

---

## 📊 Benchmark & Profiling

### Current Benchmark Gaps

- [x] **Memory profiling** - Add memory usage tracking to benchmark. ✅ Implemented in `src/memory.ts` with `StreamingProcessor`, `MemoryStats`, `MemoryProfile`

- [x] **Per-phase timing** - Break down time spent in extraction vs processing. ✅ Added to `benchmark.ts`:
  - `runPhaseTimingBenchmarks()` suite
  - Measures: File Read, Extraction, Processing, Formatting
  - Visual bar chart output
  - Identifies bottleneck automatically
  - `--skip-phases` flag to skip
  - Exports `PhaseTimingResult`, `PhaseTimingSuiteResult` types

- [x] **Comparison benchmarks** - Compare against `tsc --declaration`, `dts-bundle-generator`, `api-extractor`. ✅ Enhanced `benchmark.ts`:
  - Multiple benchmark suites (Extraction, Synthetic, Memory, Generation)
  - Configurable warmup and iterations
  - Memory delta tracking
  - Min/max/avg timing with throughput
  - Summary table with best/worst markers
  - `--quick` and `--skip-generation` flags

- [x] **Real-world fixtures** - Add benchmarks for popular libraries (lodash types, react types, etc.). ✅ Added:
  - `test/fixtures/input/real-world/lodash-like.ts` - ~500 lines of utility types
  - `test/fixtures/input/real-world/react-like.ts` - ~900 lines of component types
  - `runRealWorldBenchmarks()` function in benchmark.ts
  - `--skip-real-world` flag to skip this suite

### Optimization Targets

Based on code analysis, these are the likely bottlenecks:

1. **Regex operations** in `processDeclarations()` - ~40% of processing time (estimated)
2. **AST traversal** in `extractDeclarations()` - ~30% of processing time
3. **String operations** in type inference - ~20% of processing time
4. **File I/O** - ~10% of processing time

---

## 📝 Documentation

- [x] **API documentation** - Document all exported functions with JSDoc. ✅ Implemented in `src/docs.ts` with markdown, HTML, and JSON output

- [x] **Architecture guide** - Document the processing pipeline. ✅ Created `ARCHITECTURE.md` with comprehensive docs:
  - Core pipeline overview (Extractor → Processor → Generator)
  - Module breakdown for all components
  - Data flow and declaration structures
  - Build tool integrations (Vite, esbuild, Bun)
  - Performance characteristics and complexity analysis
  - Memory optimization strategies
  - Error handling patterns
  - Testing strategy

- [x] **Contributing guide** - How to add new features or fix bugs. ✅ Created `CONTRIBUTING.md`:
  - Development setup instructions
  - Project structure overview
  - Branch naming conventions
  - Testing guide with examples
  - Code style guidelines
  - Pull request process
  - Feature addition walkthrough
  - Bug fixing guide
  - Common development tasks

- [x] **Performance guide** - Tips for optimizing large codebases. ✅ Created `PERFORMANCE.md`:
  - Quick wins and optimization strategies
  - Incremental build configuration
  - Parallel processing with worker pools
  - Memory management and streaming
  - Build tool integration tips
  - Benchmarking guide
  - Troubleshooting common issues
  - Performance targets by project size

- [x] **Migration guide** - From tsc/other tools to dtsx. ✅ Created `MIGRATION.md`:
  - Migration from tsc --declaration
  - Migration from dts-bundle-generator
  - Migration from api-extractor
  - Migration from rollup-plugin-dts
  - Migration from tsup built-in dts
  - Common migration tasks
  - Feature comparison table
  - Troubleshooting tips

- [x] **Troubleshooting guide** - Common issues and solutions. ✅ Created `TROUBLESHOOTING.md`:
  - Installation issues (Bun, peers, TypeScript)
  - Configuration issues (config file, tsconfig, paths)
  - Generation issues (no output, empty files, missing exports)
  - Output issues (wrong directory, missing types, formatting)
  - Performance issues (slow builds, high memory, cache)
  - Build tool integration (Vite, webpack, tsup, esbuild)
  - Type-specific issues (generics, conditionals, mapped types)
  - CLI issues (commands, arguments, exit codes)
  - Quick reference table

---

## 🎯 Quick Wins (Low Effort, High Impact)

1. [x] Cache compiled RegExp patterns ✅ Extended with module-level pattern caching in processor/index.ts and extractor/helpers.ts
2. [x] Add early return in `formatComments()` when `keepComments=false` ✅ Already implemented
3. [x] Fix duplicate `declare` keyword issue ✅ Not an issue (verified)
4. [x] Add example 0012 to test suite ✅ Already included
5. [x] Remove commented-out code blocks in `processor.ts` ✅ Code is clean
6. [x] Add `--version` flag to CLI ✅ Working
7. [x] Fix import sorting to be configurable ✅ `--import-order` option exists

---

## 🚀 Roadmap Suggestions

### v1.0 (Stability)

- All critical performance issues resolved
- Complete TypeScript 5.x feature support
- 100% test coverage for existing fixtures
- Documentation complete

### v1.1 (Performance)

- [x] Incremental builds ✅ Implemented in `src/cache.ts` with content hashing and mtime tracking
- [x] Watch mode ✅ Implemented `dtsx watch` command
- [ ] Memory optimization

### v1.2 (DX)

- [x] Better error messages ✅ Implemented in `src/errors.ts` with typed errors and context
- [x] IDE integration ✅ Implemented LSP server in `src/lsp.ts`
- [x] Prettier integration ✅ Implemented in `src/formatter.ts`

### v2.0 (Advanced)

- [x] Source maps ✅ Implemented with VLQ encoding
- [x] Declaration bundling ✅ Implemented in `src/bundler.ts`
- [x] Monorepo support ✅ Implemented in `src/workspace.ts`

---

## Notes

- ~~The codebase uses Bun-specific APIs (`Bun.file`, `Bun.write`). Consider abstracting for Node.js compatibility if needed.~~ ✅ **DONE** - Node.js compatibility layer added in `src/compat.ts`
- The `bunfig` dependency for config loading may limit portability.
- ~~Current architecture is single-threaded. Consider worker threads for parallel file processing.~~ ✅ **DONE** - Worker pool implemented in `src/worker.ts`

---

## 🟣 Plugin Ecosystem

### Core Plugin System ✅ NEW

- [x] **Plugin architecture** - Implemented in `src/plugins.ts` with full lifecycle hooks:
  - `onStart` - Before generation starts
  - `onBeforeFile` - Before processing each file
  - `onDeclarations` - Transform declarations
  - `onAfterFile` - After generating each .d.ts file
  - `onEnd` - After all files processed
  - `onError` - Error handling hook

- [x] **Built-in plugins** - Several built-in plugins available:
  - `stripInternalPlugin` - Remove @internal declarations
  - `createBannerPlugin()` - Add custom header banners
  - `createFilterPlugin()` - Filter declarations by name

- [x] **Plugin API** - `definePlugin()` helper for TypeScript support

### Vite Plugin ✅ COMPLETED

- [x] **Implement vite-plugin** - Full implementation with all features. ✅ Implemented in `packages/vite-plugin/src/index.ts`

- [x] **Vite build hooks** - Integrate with Vite's build pipeline (`buildStart`, `buildEnd`, `generateBundle`). ✅ Full hook integration

- [x] **HMR support** - Hot module replacement for .d.ts files during development. ✅ `hmr` option with WebSocket notifications

- [x] **Rollup compatibility** - Ensure plugin works with Rollup directly (Vite uses Rollup under the hood). ✅ Compatible via standard plugin interface

### Bun Plugin

- [ ] **Error handling** - `bun-plugin/src/index.ts` doesn't handle generation errors gracefully.

- [ ] **Incremental mode** - Add support for only regenerating changed files.

- [ ] **Build events** - Emit events for build tooling integration.

### Future Plugins

- [x] **esbuild plugin** - Native esbuild integration. ✅ Implemented in `packages/esbuild-plugin/src/index.ts`
  - `dtsx()` - Main plugin function
  - `dtsxCheck()` - Type checking only
  - `dtsxWatch()` - Watch for declaration changes
  - Options: trigger, entryPointsOnly, declarationDir, bundle, bundleOutput
  - Callbacks: onStart, onSuccess, onError, onProgress

- [x] **webpack plugin** - For legacy webpack projects. ✅ Implemented in `packages/webpack-plugin/src/index.ts`
  - `DtsxWebpackPlugin` class with full options
  - `dtsx()` factory function
  - `dtsxCheck()` - Type checking only
  - `dtsxWatch()` - Watch for declaration changes
  - Options: trigger (emit/afterEmit/done), entryPointsOnly, declarationDir, bundle
  - Callbacks: onStart, onSuccess, onError, onProgress
  - Supports webpack 4 and webpack 5

- [x] **tsup integration** - Direct integration with tsup bundler. ✅ Implemented in `packages/tsup-plugin/src/index.ts`
  - `dtsxPlugin()` - Main plugin function
  - `createTsupConfig()` - Quick config helper
  - `defineConfig()` - Config helper with dtsx options
  - Options: trigger, entryPointsOnly, declarationDir, bundle
  - Callbacks: onStart, onSuccess, onError, onProgress
  - Supports tsup 6.x, 7.x, 8.x

---

## 🔶 Documentation vs Implementation Mismatch

The troubleshooting docs reference config options that **don't exist** in the actual implementation:

- [ ] **`trackTypes`** - Documented but not implemented
- [ ] **`trackRelationships`** - Documented but not implemented
- [ ] **`trackUsage`** - Documented but not implemented
- [ ] **`trackImports`** - Documented but not implemented
- [ ] **`profiling.memory`** - Documented but not implemented
- [ ] **`profiling.cpu`** - Documented but not implemented
- [ ] **`profiling.io`** - Documented but not implemented
- [ ] **`typeInference.strictness`** - Documented but not implemented
- [ ] **`typeChecking`** - Documented but not implemented
- [ ] **`typeValidation`** - Documented but not implemented

**Decision needed:** Either implement these features or update docs to reflect actual capabilities.

---

## 🔷 ESLint Disable Comments (Technical Debt)

These files have eslint-disable comments indicating known issues:

- [ ] **`processor.ts`** - `regexp/no-super-linear-backtracking`, `regexp/no-misleading-capturing-group`, `regexp/optimal-quantifier-concatenation`, `regexp/no-unused-capturing-group`

- [ ] **`extractor.ts`** - `no-case-declarations`, `regexp/no-contradiction-with-assertion`

- [ ] **`parser.ts`** - `regexp/no-super-linear-backtracking`

- [ ] **`generator.ts`** - `no-console` (should use proper logging)

- [x] **`utils.ts`** - `unused-imports/no-unused-vars` (error variable not used) ✅ Fixed with empty catch

---

## 🔸 CLI Improvements

- [x] **`--help` improvements** - Add examples for each command. ✅ Examples added

- [x] **`--dry-run` flag** - Show what would be generated without writing files. ✅ Implemented

- [x] **`--diff` flag** - Show differences from existing .d.ts files. ✅ Implemented

- [x] **`--validate` flag** - Validate generated .d.ts against TypeScript compiler. ✅ Implemented

- [x] **`--stats` flag** - Show statistics (files processed, declarations found, etc.). ✅ Implemented

- [x] **Exit codes** - Proper exit codes for different error conditions. ✅ 0=success, 1=all failed, 2=partial

- [x] **Stdin support** - Accept TypeScript code from stdin. ✅ `dtsx stdin` command

- [x] **JSON output** - `--format json` for programmatic consumption. ✅ `--output-format json`

- [x] **Parallel processing** - `--parallel` flag for multi-file processing. ✅ Implemented with `--concurrency` option

---

## 🔹 Type Inference Edge Cases

Based on test fixtures analysis:

- [ ] **Async generators** - `async function*` returns `any` instead of `AsyncGenerator<T>`.

  ```typescript
  // Input: export async function* complexAsyncGenerator(): any
  // Should infer: AsyncGenerator<...> when possible
  ```

- [ ] **Type predicates** - `value is User` works but needs more testing.

- [ ] **`this` type assertions** - `this is { readonly value: T }` in class methods.

- [ ] **Constructor parameter properties** - Works but verify edge cases with decorators.

- [ ] **Default parameter values in constructors** - `value: T | null = null` becomes `value?: T | null`.

---

## 📦 Package & Distribution

- [ ] **Types path mismatch** - `package.json` has `"types": "./dist/index.d.ts"` but exports point to `./dist/src/index.js`. Verify alignment.

- [ ] **Peer dependencies** - Consider making `typescript` a peer dependency.

- [x] **Bundle size** - Analyzed and documented. ✅ Bundle is ~4.1MB due to TypeScript compiler (~3.5MB). This is unavoidable for AST-based parsing.
  - TypeScript compiler is required for core AST parsing functionality
  - Bundle is tree-shakeable for unused features
  - Documentation added to `src/index.ts` for minimal import paths
  - Use `import { generate } from '@stacksjs/dtsx/generator'` for minimal bundle if not using advanced features

- [x] **Tree-shakeable exports** - Ensured library is fully tree-shakeable. ✅
  - Organized exports in `src/index.ts` by category (Core, Utilities, Advanced)
  - Added documentation comments for selective imports
  - Bun's bundler supports code splitting and tree-shaking

- [ ] **CommonJS support** - Currently ESM only. Not planned - dtsx is designed for modern ESM environments (Bun).

- [x] **Node.js compatibility** - Abstract Bun-specific APIs for Node.js fallback. ✅ Created `src/compat.ts`:
  - `isBun` / `isNode` runtime detection
  - `file()` - Cross-runtime file handle (Bun.file replacement)
  - `write()` - Cross-runtime file writer (Bun.write replacement)
  - `spawnProcess()` - Cross-runtime process spawner (Bun.spawn replacement)
  - `FileHandle` interface compatible with Bun.file()
  - `SpawnResult` interface compatible with Bun.spawn()
  - `getRuntimeInfo()` for version and runtime detection
  - Updated generator.ts, utils.ts, diff.ts to use compat layer

---

## 🧪 Test Coverage Gaps

- [x] **Example 0012** - Test file exists in fixtures but not in test array. ✅ Already included

- [x] **`checker.ts`** - Large fixture file excluded from tests. ✅ Added `test/checker.test.ts` with 34 tests covering:
  - `typeCheck()` - Type checking with various options
  - `validateDeclarations()` - Validate .d.ts files
  - `checkIsolatedDeclarations()` - Check isolatedDeclarations compatibility
  - `getTypeAtPosition()` - Get type info at position
  - `getQuickInfo()` - Get hover information
  - `formatTypeCheckResults()` - Format results
  - `loadCompilerOptions()` - Load from tsconfig
  - Complex type handling (generics, conditionals, mapped types, template literals)

- [x] **Error scenarios** - No tests for malformed TypeScript input. ✅ Added `test/errors.test.ts` with 52 tests:
  - Malformed input (empty, whitespace, unclosed braces, syntax errors)
  - Invalid syntax (duplicate keywords, random characters, unmatched quotes)
  - Edge cases (Unicode, null bytes, BOM, mixed line endings)
  - Complex declarations (abstract class, const enum, namespace, module)

- [ ] **Edge case coverage** - `edge-cases.ts` fixture exists but verify all cases pass.

- [x] **Plugin tests** - No tests for bun-plugin or vite-plugin. ✅ Added `test/plugins.test.ts` with 22 tests

- [x] **Transformer tests** - ✅ Added `test/transformers.test.ts` with 35 tests

- [x] **CLI tests** - No integration tests for CLI commands. ✅ Added `test/cli.test.ts` with 21 tests

- [ ] **Benchmark regression** - No CI integration for performance benchmarks.

---

## ⚡ Concurrency & Parallelism

- [x] **Worker threads for file processing** - Process multiple files in parallel using Bun workers. ✅ Implemented in `src/worker.ts`

- [x] **Async AST parsing** - ✅ Implemented in `src/extractor/cache.ts`:
  - `getSourceFileAsync()` - Async version with event loop yielding for large files
  - `batchParseSourceFiles()` - Batch parse with concurrency control
  - `shouldUseAsyncParsing()` - Check if async parsing should be used based on file size
  - `AsyncParseConfig` interface for configuration (asyncThreshold, chunkSize, yieldInterval)
  - `extractDeclarationsAsync()` - Async declaration extraction
  - `batchExtractDeclarations()` - Batch extraction with concurrency
  - Added `test/async-parsing.test.ts` with 19 tests

- [x] **Streaming output** - Write .d.ts files as they're generated instead of waiting for all files. ✅ Implemented in `src/memory.ts`

- [x] **File batching** - Group small files for batch processing to reduce overhead. ✅ `batchFiles()` and `calculateOptimalBatchSize()` in `src/worker.ts`

- [ ] **Dependency graph parallelism** - Build dependency graph and process independent files in parallel.

---

## 🎨 Output Quality & Formatting

- [ ] **Consistent newlines** - Ensure consistent line endings (LF vs CRLF).

- [ ] **Trailing newline** - Always end files with a single newline.

- [ ] **Import grouping** - Group imports by source (node:, external, internal).

- [ ] **Declaration ordering** - Consistent ordering (types, interfaces, classes, functions, variables).

- [ ] **Whitespace normalization** - Remove excessive blank lines in output.

- [ ] **Comment preservation fidelity** - Ensure JSDoc tags are preserved exactly.

---

## 🔐 Security & Robustness

- [ ] **Path traversal protection** - Validate file paths don't escape project root.

- [ ] **Symlink handling** - Decide behavior for symbolic links.

- [ ] **Large file protection** - Add configurable size limits to prevent OOM.

- [ ] **Timeout handling** - Add configurable timeout for processing.

- [x] **Graceful degradation** - Continue processing other files if one fails. ✅ `--continue-on-error` option

---

## Notes

- ~~The codebase uses Bun-specific APIs (`Bun.file`, `Bun.write`). Consider abstracting for Node.js compatibility if needed.~~ ✅ **DONE** - Node.js compatibility layer added
- ~~Current architecture is single-threaded. Consider worker threads for parallel file processing.~~ ✅ **DONE** - Worker pool implemented
- ~~The vite-plugin is essentially a placeholder (`export const wip = true`).~~ ✅ **DONE** - Full Vite plugin implemented

---

---

## ✅ Recently Implemented Features

### Session: November 26, 2025

#### New Modules Created

- **`src/plugins.ts`** - Full plugin system with lifecycle hooks
- **`src/bundler.ts`** - Declaration file bundling with import deduplication
- **`src/cache.ts`** - Incremental build caching with content hashing
- **`src/workspace.ts`** - Multi-project/monorepo support
- **`src/docs.ts`** - API documentation generator from JSDoc
- **`src/optimizer.ts`** - Declaration file optimizer (tree-shaking, minification)
- **`src/lsp.ts`** - Language Server Protocol implementation
- **`src/errors.ts`** - Typed error system with context
- **`test/generator.test.ts`** - Comprehensive generator tests (27 tests)

#### CLI Commands Added

- `dtsx workspace` - Generate declarations for monorepo projects
- `dtsx docs` - Generate API documentation
- `dtsx optimize` - Optimize declaration files
- `dtsx lsp` - Start LSP server for IDE integration

#### Config Enhancements

- `defineConfig()` helper for TypeScript intellisense
- Support for `dtsx.config.ts` configuration files
- New options: `plugins`, `bundle`, `bundleOutput`, `incremental`, `clearCache`

#### Additional Features (November 26, 2025)

- **`src/transformers.ts`** - Custom transformers API for AST-level transformations
  - `Transformer` type for declaration-level transforms
  - `composeTransformers()` for chaining transformers
  - `filterByKind()`, `filterByPredicate()` for conditional transforms
  - Built-in transformers: rename, prefix, suffix, remove, JSDoc, type, readonly, required, optional
  - `createTransformerPlugin()` to convert transformers to plugins

- **`src/checker.ts`** - TypeScript type checking integration
  - `typeCheck()` - Full type checking with diagnostics
  - `validateDeclarations()` - Validate generated .d.ts files
  - `checkIsolatedDeclarations()` - Check isolatedDeclarations compatibility
  - `getTypeAtPosition()`, `getQuickInfo()` - Type information at cursor
  - `formatTypeCheckResults()` - Human-readable output

- **`src/formats.ts`** - Additional output formats
  - `toJsonSchema()` - Convert to JSON Schema (draft-07, 2019-09, 2020-12)
  - `toZod()` - Convert to Zod schemas
  - `toValibot()` - Convert to Valibot schemas
  - `toIoTs()` - Convert to io-ts codecs
  - `toYup()` - Convert to Yup schemas
  - `toArkType()` - Convert to ArkType schemas

#### CLI Commands Added

- `dtsx check` - Type check files with isolated declarations support
- `dtsx convert` - Convert TypeScript types to different schema formats
- `dtsx circular` - Detect circular dependencies (Session 9)

#### Latest Features (November 26, 2025)

- **`src/formatter.ts`** - Prettier integration and built-in formatter
  - Auto-detects and uses Prettier if available
  - Built-in fallback formatter with import sorting/grouping
  - Line wrapping for long type definitions

- **`src/diff.ts`** - Diff output for comparing declarations
  - LCS-based diff algorithm
  - Unified diff format output
  - Colored terminal output
  - Summary statistics

- **`test/plugins.test.ts`** - Plugin system tests (22 tests)
- **`test/transformers.test.ts`** - Transformer API tests (35 tests)
- **`test/cli.test.ts`** - CLI integration tests (21 tests)

#### More Features (November 26, 2025 - Continued)

- **`src/import-sorter.ts`** - Configurable import sorting
  - Group-based sorting (builtin, external, internal, parent, sibling, index, type)
  - Alphabetization options with case sensitivity control
  - Custom order patterns with regex support
  - Presets: default, node, bun, typeSeparated, alphabetical, none
  - `sortImports()`, `sortImportsInContent()`, `createImportSorter()`

- **`src/merger.ts`** - Declaration merging module
  - Interface merging (combines members, extends clauses)
  - Namespace/module merging
  - Enum merging with conflict resolution
  - Type alias merging (creates unions)
  - Conflict strategies: first, last, error
  - Deduplication of identical declarations
  - `mergeDeclarations()`, `mergeDeclarationsInContent()`

- **`src/tree-shaker.ts`** - Tree shaking for unused types
  - Dependency graph analysis with `buildDependencyGraph()`
  - Entry point detection (exported declarations)
  - Keep/remove patterns with glob and regex support
  - Configurable shakable kinds (type, interface, etc.)
  - `treeShake()`, `treeShakeContent()`, `findUnusedDeclarations()`
  - `analyzeDependencies()` for dependency inspection

- **`src/watcher.ts`** - Watch mode for auto-regeneration
  - File system watching with debounce
  - Include/exclude patterns with glob support
  - Callbacks: onChange, onBuildStart, onBuildComplete, onError
  - `createWatcher()`, `watchAndGenerate()`
  - `formatWatchResult()`, `createWatchLogger()`

- **`src/incremental.ts`** - Incremental build support
  - `IncrementalCache` class with file hash validation
  - Cache manifest with dependency tracking
  - Config hash invalidation when settings change
  - Cache statistics (hits, misses, hit ratio, time saved)
  - `createIncrementalBuilder()` for build integration
  - `extractDependencies()` for import analysis

- **`src/sourcemap.ts`** - Source map support
  - `SourceMapGenerator` with VLQ encoding
  - `SourceMapConsumer` for reading source maps
  - Source map v3 format support
  - Inline and external source map options
  - `createSourceMap()`, `appendSourceMapComment()`, `appendInlineSourceMap()`
  - `extractSourceMap()` for reading existing maps
  - `buildDeclarationMappings()` for declaration-to-source mapping

**Total tests: 132** (up from 54)

#### Latest Features (November 26, 2025 - Session 2)

- **`src/lsp.ts`** - Enhanced LSP with additional features
  - `references()` - Find all references to a symbol
  - `prepareRename()` / `rename()` - Rename symbol across files
  - `documentSymbols()` - Document outline/symbols
  - `workspaceSymbols()` - Search symbols across workspace
  - `codeActions()` - Quick fixes and refactorings
  - `signatureHelp()` - Function parameter hints
  - `documentHighlight()` - Highlight occurrences
  - `formatting()` - Format document
  - New types: `SymbolKind`, `CompletionItemKind`, `DocumentHighlightKind`
  - Code actions: add type annotation, replace 'any' with 'unknown', extract signature

- **`src/docs.ts`** - Enhanced API documentation generation
  - JSON output format with `generateJSON()`
  - TypeDoc-compatible JSON with `generateTypeDocJSON()`
  - Split by module option (`splitByModule`)
  - New config options: `includeTypes`, `template`, `customCss`, `includeSidebar`
  - `createDocsGenerator()` factory function

- **`src/bundler.ts`** - Enhanced declaration bundling
  - `BundleConfig` interface with comprehensive options
  - `bundleDtsFiles()` - Bundle multiple .d.ts files into one
  - `bundleAndWrite()` - Bundle and write to file
  - `createBundler()` - Factory with preset config
  - Features: ambient module wrapper, external exclusion, duplicate merging
  - Banner/footer support, triple-slash references
  - Alphabetical declaration sorting option

#### Latest Features (November 26, 2025 - Session 3)

- **`src/worker.ts`** - Worker thread parallelization
  - `WorkerPool` class for managing worker threads
  - `WorkerTask` / `WorkerResult` interfaces
  - `WorkerStats` for monitoring performance
  - `createWorkerPool()` factory function
  - `parallelProcess()` for one-off parallel processing
  - `batchFiles()` and `calculateOptimalBatchSize()` helpers
  - Configurable: maxWorkers, taskTimeout, recycleAfter, idleTimeout

- **`src/memory.ts`** - Memory optimization utilities
  - `StreamingProcessor` class for large file handling
  - `DeclarationPool` with WeakRef for memory-efficient caching
  - `LazyLoader<T>` for deferred loading
  - `StringInterner` for string deduplication
  - `ObjectPool<T>` for object reuse
  - `MemoryStats` / `MemoryProfile` interfaces
  - `estimateMemoryUsage()` for file size analysis
  - `formatMemoryStats()` for display
  - Streaming file read/write with chunking

- **`packages/vite-plugin/src/index.ts`** - Full Vite plugin implementation
  - `dts()` - Main plugin function with comprehensive options
  - `dtsCheck()` - Type checking only plugin
  - `dtsBundled()` - Bundled declarations plugin
  - Watch mode with debouncing
  - HMR support with WebSocket notifications
  - Lifecycle hooks: onStart, onSuccess, onError, onFileChange
  - Options: trigger, timing, watch, hmr, insertTypesEntry, sourceMaps
  - Integration with Vite's build pipeline

#### Latest Features (November 26, 2025 - Session 4)

- **`packages/esbuild-plugin/src/index.ts`** - esbuild plugin for dtsx
  - `dtsx()` - Main plugin with full options
  - `dtsxCheck()` - Type checking only
  - `dtsxWatch()` - Watch for .d.ts changes
  - Features: bundled declarations, file filters, callbacks
  - Options: trigger, entryPointsOnly, declarationDir, bundle, bundleOutput
  - Compatible with esbuild watch mode

- **`packages/esbuild-plugin/package.json`** - Package configuration
- **`packages/esbuild-plugin/build.ts`** - Build script
- **`packages/esbuild-plugin/README.md`** - Usage documentation

- **`benchmark.ts`** - Comprehensive benchmark suite
  - `runExtractionBenchmarks()` - Test extraction on fixture files
  - `runGenerationBenchmarks()` - Test full generation pipeline
  - `runMemoryBenchmarks()` - Memory usage analysis
  - `runSyntheticBenchmarks()` - Scalability testing (100-10000 lines)
  - `generateLargeTypeScriptFile()` - Synthetic file generator
  - Features: warmup, configurable iterations, memory delta
  - Output: summary table with best/worst markers
  - CLI flags: `--quick`, `--skip-generation`, `--verbose`

- **`ARCHITECTURE.md`** - Architecture documentation
  - Core pipeline diagram and explanation
  - Module breakdown for all 20+ components
  - Data flow with declaration structures
  - Build tool integration examples
  - Performance characteristics and complexity
  - Memory optimization strategies
  - Error handling patterns
  - Testing strategy overview
  - Future architecture roadmap

#### Latest Features (November 26, 2025 - Session 5)

- **`packages/webpack-plugin/src/index.ts`** - webpack plugin for dtsx
  - `DtsxWebpackPlugin` class implementing `WebpackPluginInstance`
  - `dtsx()` factory function for convenience
  - `dtsxCheck()` - Type checking only plugin
  - `dtsxWatch()` - Watch for .d.ts changes
  - Trigger options: emit, afterEmit, done
  - Features: bundled declarations, file filters, callbacks
  - Smart caching for watch mode (skipUnchanged)
  - Supports webpack 4 and webpack 5

- **`packages/webpack-plugin/package.json`** - Package configuration
- **`packages/webpack-plugin/build.ts`** - Build script
- **`packages/webpack-plugin/README.md`** - Usage documentation with examples

- **`benchmark.ts`** - Per-phase timing benchmarks added
  - `runPhaseTimingBenchmarks()` - New suite
  - Measures: File Read, Extraction, Processing, Formatting
  - Visual bar chart output with percentage breakdown
  - Automatic bottleneck identification
  - `printPhaseTimingSummary()` for results display
  - New types: `PhaseTimingResult`, `PhaseTimingSuiteResult`
  - `--skip-phases` flag to skip this suite

- **`CONTRIBUTING.md`** - Comprehensive contributing guide
  - Development setup instructions
  - Project structure overview
  - Branch naming conventions
  - Testing guide with examples
  - Code style guidelines
  - Pull request process
  - Feature addition walkthrough
  - Bug fixing guide
  - Common development tasks
  - AST working tips

#### Latest Features (November 26, 2025 - Session 6)

- **`packages/tsup-plugin/src/index.ts`** - tsup plugin for dtsx
  - `dtsxPlugin()` - Main plugin function
  - `createTsupConfig()` - Quick config factory
  - `defineConfig()` - Helper with dtsx options built-in
  - Trigger options: buildStart, buildEnd
  - Features: bundled declarations, file filters, callbacks
  - Auto-detects tsup's dts option (skipIfTsupDts)
  - Supports tsup 6.x, 7.x, 8.x

- **`packages/tsup-plugin/package.json`** - Package configuration
- **`packages/tsup-plugin/build.ts`** - Build script
- **`packages/tsup-plugin/README.md`** - Usage documentation with examples

- **`PERFORMANCE.md`** - Comprehensive performance guide
  - Quick wins (entry points, incremental, exclude patterns)
  - Configuration optimization examples
  - Incremental build setup and cache management
  - Parallel processing with WorkerPool
  - Memory management and streaming
  - Build tool integration tips
  - Benchmarking instructions
  - Troubleshooting slow builds
  - Performance targets by project size

- **`MIGRATION.md`** - Migration guide from other tools
  - From tsc --declaration
  - From dts-bundle-generator
  - From api-extractor (with @internal plugin)
  - From rollup-plugin-dts
  - From tsup built-in dts
  - Common migration tasks
  - Feature comparison table (6 tools)
  - Path aliases and JSDoc handling
  - Troubleshooting migration issues

#### Latest Features (November 26, 2025 - Session 7)

- **`TROUBLESHOOTING.md`** - Comprehensive troubleshooting guide
  - Installation issues (Bun, peers, TypeScript)
  - Configuration issues (config file, tsconfig, paths)
  - Generation issues (no output, empty files, missing exports)
  - Output issues (wrong directory, missing types, formatting)
  - Performance issues (slow builds, high memory, cache)
  - Build tool integration (Vite, webpack, tsup, esbuild)
  - Type-specific issues (generics, conditionals, mapped types)
  - CLI issues (commands, arguments, exit codes)
  - Quick reference table with common fixes

- **Real-world benchmark fixtures**
  - `test/fixtures/input/real-world/lodash-like.ts` - ~500 lines of utility types
    - Collection operations, deep types, iteratees, comparators
    - Array, collection, object, string method types
  - `test/fixtures/input/real-world/react-like.ts` - ~900 lines of component types
    - JSX types, element types, component types
    - Hooks (useState, useEffect, useContext, useMemo, etc.)
    - Context API, events, HTML attributes
  - `runRealWorldBenchmarks()` function in benchmark.ts
  - `--skip-real-world` flag to skip this suite

- **`src/compat.ts`** - Node.js compatibility layer
  - `isBun` / `isNode` runtime detection constants
  - `runtime` - Current runtime name ('bun' | 'node')
  - `file(path)` - Cross-runtime file handle (Bun.file replacement)
    - `exists()`, `text()`, `arrayBuffer()`, `size`, `name`
  - `write(path, content)` - Cross-runtime file writer (Bun.write replacement)
  - `spawnProcess(cmd, opts)` - Cross-runtime process spawner (Bun.spawn replacement)
    - Returns `SpawnResult` with pid, stdout, stderr, stdin, exited, kill()
  - `readTextFile()`, `writeTextFile()`, `fileExists()` - Convenience functions
  - `getRuntimeInfo()` - Get runtime name and version
  - Updated `generator.ts`, `utils.ts`, `diff.ts` to use compat layer

#### Latest Features (November 26, 2025 - Session 8)

- **`test/checker.test.ts`** - Comprehensive type checker tests (34 tests)
  - `typeCheck()` - Type checking with include/exclude patterns, maxErrors, warningsAsErrors
  - `validateDeclarations()` - Validate .d.ts files
  - `checkIsolatedDeclarations()` - Check isolatedDeclarations compatibility
  - `getTypeAtPosition()` - Get type info at position (with bounds checking)
  - `getQuickInfo()` - Get hover information
  - `formatTypeCheckResults()` - Format results as string
  - `loadCompilerOptions()` - Load/merge from tsconfig
  - Complex type handling (generics, conditionals, mapped types, template literals)

- **`src/checker.ts`** - Improved with bounds checking
  - `getTypeAtPosition()` now validates line/column bounds before calling TS API
  - `getQuickInfo()` now validates bounds and handles edge cases gracefully
  - Returns null for invalid positions instead of throwing

- **`src/circular.ts`** - Circular dependency detection module
  - `DependencyNode` interface for graph nodes
  - `CircularDependency` interface with chain, symbols, severity, reason
  - `buildDependencyGraph()` - Build import/export dependency graph from files
  - `detectCircularDependencies()` - Find cycles using DFS algorithm
  - `analyzeCircularDependencies()` - Full analysis with timing
  - `formatCircularAnalysis()` - Human-readable output with severity icons
  - `getGraphSummary()` - Statistics about the dependency graph
  - `findAllDependents()` / `findAllDependencies()` - Transitive dependency lookup
  - `exportGraphAsDot()` - Export as Graphviz DOT format
  - `exportGraphAsJson()` - Export as JSON format
  - Deduplication of rotated cycles
  - Type-only vs value-only cycle detection

**Total tests: 166** (up from 132)

#### Latest Features (November 27, 2025 - Session 9)

- **`test/errors.test.ts`** - Error handling tests (52 tests)
  - Malformed TypeScript input handling
  - Invalid syntax (unclosed braces, duplicate keywords, random characters)
  - Edge cases (Unicode, null bytes, BOM, CRLF)
  - Complex declarations (abstract class, const enum, namespace, module, using)

- **`bin/cli.ts`** - Added `dtsx circular` command
  - Detect circular dependencies in TypeScript files
  - Options: `--files`, `--root`, `--ignore`, `--types-only`, `--max-depth`
  - Output formats: text, json, dot (for Graphviz)
  - `--summary` flag for dependency graph statistics
  - Exit code 1 if cycles found

- **`src/processor/imports.ts`** - Enhanced type-only import handling
  - `ImportItem` interface with individual `isTypeOnly` property
  - `ParsedImport` interface with detailed parsing results
  - `parseImportDetailed()` - Full parsing with type-only detection per item
  - `parseExportDetailed()` - Parse exports with type-only detection
  - `mergeImports()` - Combine value and type imports from same module
  - `isTypeOnlyImportItem()` - Check if item has `type` prefix
  - `convertToTypeOnlyImport()` - Convert to `import type`
  - Handles: `import { type X, Y }`, `export { type X }`, `export type * from`

- **`test/fixtures/input/type-only-imports.ts`** - Type-only import test fixture
  - Mixed imports (`import { value, type Type }`)
  - Type re-exports (`export type { X }`)
  - Namespace re-exports (`export type * from`)
  - Complex type usage (conditionals, mapped types)

**Total tests: 218** (up from 166)

#### Latest Features (November 27, 2025 - Session 10)

- **`test/fuzzing.test.ts`** - Property-based/fuzzing tests (25 tests)
  - Random declaration generators (functions, interfaces, types, classes, enums)
  - Malformed input resilience tests (unclosed braces, invalid syntax)
  - Stress tests (many declarations, deep nesting, large files)
  - Performance characteristics tests
  - Generates random TypeScript code and verifies extraction works

- **`src/extractor/cache.ts`** - Async AST parsing support
  - `AsyncParseConfig` interface (asyncThreshold, chunkSize, yieldInterval)
  - `getSourceFileAsync()` - Async version with event loop yielding
  - `batchParseSourceFiles()` - Batch parse with concurrency control
  - `shouldUseAsyncParsing()` - Check if file exceeds async threshold
  - `getPendingParseCount()` - Monitor pending async operations

- **`src/extractor/index.ts`** - Async extraction functions
  - `extractDeclarationsAsync()` - Async declaration extraction
  - `batchExtractDeclarations()` - Batch extraction with concurrency
  - Exports `AsyncParseConfig` type

- **`test/async-parsing.test.ts`** - Async parsing tests (19 tests)
  - `shouldUseAsyncParsing()` threshold testing
  - `getSourceFileAsync()` caching and deduplication
  - `extractDeclarationsAsync()` equivalence with sync version
  - `batchParseSourceFiles()` concurrency
  - `batchExtractDeclarations()` with comments
  - Performance characteristics (non-blocking)
  - Error handling in async mode

- **`src/index.ts`** - Improved with documentation
  - Organized exports by category (Core, Utilities, Advanced)
  - Added documentation for selective imports and bundle size

**Total tests: 262** (up from 218)

#### Latest Features (November 27, 2025 - Session 11)

- **Advanced TypeScript Features Support**
  - Private class fields (#field) - Excluded from .d.ts output
  - Private methods (#method) - Excluded from .d.ts output
  - Private accessors - Excluded from .d.ts output
  - Static blocks - Excluded from .d.ts output (implementation detail)
  - Symbol property keys - [Symbol.iterator], [Symbol.dispose], etc.
  - Generator methods with symbols - `*[Symbol.iterator]()`
  - `as const` assertions - Preserves literal types
  - Computed property names - `[KEY]: type` syntax
  - readonly interface properties - Preserved in output

- **`src/extractor/builders.ts`** - Enhanced class/interface building
  - `isPrivateMemberName()` - Detect private identifiers (#field)
  - `isSymbolPropertyName()` - Detect symbol property names
  - `getMemberNameText()` - Handle computed property names
  - `getInterfaceMemberName()` - Handle computed properties in interfaces
  - Updated `buildClassBody()` to exclude private members and static blocks
  - Updated `getInterfaceBody()` to preserve readonly modifiers

- **`src/extractor/declarations.ts`** - Enhanced variable extraction
  - `isAsConstAssertion()` - Detect `as const` assertions
  - `inferAsConstType()` - Infer literal types for `as const`
  - Updated `extractVariableStatement()` to handle `as const`

- **`test/fixtures/input/ts-features.ts`** - Comprehensive test fixture
  - import.meta types
  - as const objects and arrays
  - Computed property names
  - Symbol property keys
  - Private class fields
  - Static blocks
  - using declarations

- **`test/ts-features.test.ts`** - Feature tests (15 tests)
  - Private class fields exclusion
  - Static blocks exclusion
  - Symbol property keys in interfaces and classes
  - as const assertions
  - Computed property names
  - Generator methods
  - readonly interface properties
  - using declarations (Disposable)

**Total tests: 277** (up from 262)

---

*Last updated: November 27, 2025*
*Generated from codebase analysis of dtsx v0.9.9*
