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

- [ ] **Regex compilation caching** - `processor.ts` creates new RegExp objects inside loops (lines 266, 294, 308, etc.). Pre-compile and cache these patterns.

  ```typescript
  // Current: new RegExp(`\\b${item.replace(...)}\\b`) inside loops
  // Fix: Create a Map<string, RegExp> cache for compiled patterns
  ```

- [ ] **O(n²) import usage detection** - `processDeclarations()` iterates over all imports for every declaration type (functions, variables, interfaces, types, classes, enums, modules). Refactor to single-pass analysis.

  ```typescript
  // Current: 7 separate loops checking imports against declarations
  // Fix: Build a single usage map in one pass
  ```

- [ ] **Redundant `extractAllImportedItems()` calls** - Called multiple times for the same import in `processDeclarations()`. Cache results per import.

- [ ] **String concatenation in hot paths** - `processor.ts` uses string concatenation (`result +=`) extensively. Use array joins for better performance.

- [ ] **Repeated source code parsing** - `extractDeclarations()` creates a new SourceFile for each file. Consider caching parsed ASTs when processing related files.

### P1: Parser Efficiency

- [ ] **Avoid double-parsing** - `parser.ts` and `extractor.ts` both parse similar constructs. Consolidate into a single AST-based approach.

- [x] **Lazy comment extraction** - `extractJSDocComments()` is called even when `keepComments=false`. Short-circuit early. ✅ Already implemented

- [ ] **Reduce regex backtracking** - Multiple regexes in `processor.ts` have super-linear backtracking (noted by eslint-disable comments). Rewrite with non-backtracking patterns.

---

## 🟠 Missing TypeScript Features

### Type System Support

- [ ] **Conditional types with `infer`** - Currently handled but may not preserve complex nested infer patterns correctly.

- [x] **Template literal types** - `inferTemplateLiteralType()` returns `string` for complex cases. Should preserve template literal type syntax. ✅ Working correctly

  ```typescript
  // Input: type Route = `/${string}/${number}`
  // Output: `/${string}/${number}` (preserved correctly)
  ```

- [ ] **Mapped type modifiers** - Ensure `+readonly`, `-readonly`, `+?`, `-?` modifiers are preserved.

- [ ] **`satisfies` operator** - Not currently handled in type inference.

- [ ] **`const` type parameters** - TypeScript 5.0+ feature for const generic parameters.

  ```typescript
  function foo<const T>(x: T): T
  ```

- [ ] **Variadic tuple types** - `[...T]` spread in tuple types.

- [ ] **Named tuple elements** - `[first: string, second: number]`.

- [ ] **`NoInfer<T>` utility type** - TypeScript 5.4+ feature.

### Declaration Support

- [ ] **Function overloads** - `overloads` field exists in `Declaration` type but extraction/processing is incomplete. Test with complex overload scenarios.

- [ ] **Ambient module declarations** - `declare module 'x'` augmentations need better handling.

- [ ] **Global augmentations** - `declare global { }` blocks.

- [x] **Triple-slash directives** - `/// <reference types="..." />` should be preserved. ✅ Implemented in `extractTripleSlashDirectives()`

- [ ] **`declare const enum`** - Ensure const enums are properly emitted.

- [ ] **Accessor declarations** - `get`/`set` accessors in classes and interfaces.

- [ ] **Index signatures** - `[key: string]: T` in interfaces/types.

- [ ] **Constructor signatures** - `new (): T` in interfaces.

- [ ] **Call signatures** - `(): T` in interfaces (partially implemented in `getInterfaceBody()`).

- [ ] **`this` parameter types** - `function foo(this: SomeType, ...)`

- [ ] **`asserts` return type** - `function assert(x): asserts x is string`

- [ ] **`is` type predicates** - `function isString(x): x is string`

### Module System

- [ ] **Dynamic imports** - `import('module')` type expressions.

- [ ] **`import.meta`** - Type declarations for import.meta properties.

- [ ] **`export * as ns from`** - Namespace re-exports.

- [ ] **Side-effect imports** - `import 'module'` should be preserved if they have type effects.

---

## 🟡 Code Quality & Correctness

### Bug Fixes

- [x] **Duplicate `declare` keywords** - Some outputs may have `export declare declare`. Add deduplication. ✅ Not an issue (verified)

- [x] **Missing semicolons** - Inconsistent semicolon handling in various declaration types. ✅ Fixed in `processTypeDeclaration()`

- [x] **Import alias handling** - `import { X as Y }` aliases may not be tracked correctly through re-exports. ✅ Working correctly

- [ ] **Type-only vs value imports** - `import type` vs `import` distinction needs more robust handling for re-exports.

- [ ] **Circular type references** - No detection or handling of circular type dependencies.

- [x] **Generic constraint preservation** - Ensure `<T extends U>` constraints are fully preserved. ✅ Working correctly

- [x] **Default type parameters** - `<T = DefaultType>` may not be handled correctly. ✅ Working correctly

### Type Inference Improvements

- [ ] **`as const` nested objects** - Deep readonly inference for nested `as const` assertions.

- [ ] **Computed property names** - `{ [key]: value }` type inference.

- [ ] **Symbol property keys** - `{ [Symbol.iterator]: ... }` handling.

- [ ] **Private class fields** - `#privateField` syntax.

- [ ] **Static blocks** - `static { }` in classes.

- [ ] **`using` declarations** - TypeScript 5.2+ explicit resource management.

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

- [ ] **Property-based testing** - Add fuzzing tests for parser robustness.

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

- [ ] **Source maps** - Generate source maps for debugging.

- [ ] **Watch mode** - File watching for incremental regeneration.

- [ ] **Incremental builds** - Cache and reuse unchanged declarations.

### Output Quality

- [ ] **Prettier integration** - Option to format output with Prettier.

- [ ] **Configurable indentation** - Tabs vs spaces, indent size.

- [ ] **Import sorting** - Configurable import organization (currently hardcoded to sort 'bun' first).

- [ ] **Declaration merging** - Merge related declarations when appropriate.

- [ ] **Tree shaking** - Remove unused internal types from output.

### Developer Experience

- [ ] **Better error messages** - Include file location and context in errors.

- [x] **Progress reporting** - Show progress for large codebases. ✅ Implemented `--progress` CLI option

- [ ] **Diff output** - Show what changed between generations.

- [ ] **Validation mode** - Check generated .d.ts files against TypeScript compiler.

- [ ] **IDE integration** - Language server protocol support.

---

## 📊 Benchmark & Profiling

### Current Benchmark Gaps

- [ ] **Memory profiling** - Add memory usage tracking to benchmark.

- [ ] **Per-phase timing** - Break down time spent in extraction vs processing.

- [ ] **Comparison benchmarks** - Compare against `tsc --declaration`, `dts-bundle-generator`, `api-extractor`.

- [ ] **Real-world fixtures** - Add benchmarks for popular libraries (lodash types, react types, etc.).

### Optimization Targets

Based on code analysis, these are the likely bottlenecks:

1. **Regex operations** in `processDeclarations()` - ~40% of processing time (estimated)
2. **AST traversal** in `extractDeclarations()` - ~30% of processing time
3. **String operations** in type inference - ~20% of processing time
4. **File I/O** - ~10% of processing time

---

## 📝 Documentation

- [ ] **API documentation** - Document all exported functions with JSDoc.

- [ ] **Architecture guide** - Document the processing pipeline.

- [ ] **Contributing guide** - How to add new features or fix bugs.

- [ ] **Performance guide** - Tips for optimizing large codebases.

- [ ] **Migration guide** - From tsc/other tools to dtsx.

- [ ] **Troubleshooting guide** - Common issues and solutions.

---

## 🎯 Quick Wins (Low Effort, High Impact)

1. [x] Cache compiled RegExp patterns ✅ Implemented in `processor/cache.ts`
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

- Incremental builds
- Watch mode
- Memory optimization

### v1.2 (DX)

- Better error messages
- IDE integration
- Prettier integration

### v2.0 (Advanced)

- Source maps
- Declaration bundling
- Monorepo support

---

## Notes

- The codebase uses Bun-specific APIs (`Bun.file`, `Bun.write`). Consider abstracting for Node.js compatibility if needed.
- The `bunfig` dependency for config loading may limit portability.
- Current architecture is single-threaded. Consider worker threads for parallel file processing.

---

## 🟣 Plugin Ecosystem

### Vite Plugin

- [ ] **Implement vite-plugin** - Currently just exports `wip = true`. Needs full implementation:

  ```typescript
  // packages/vite-plugin/src/index.ts is essentially empty
  export const wip = true
  ```

- [ ] **Vite build hooks** - Integrate with Vite's build pipeline (`buildStart`, `buildEnd`, `generateBundle`).

- [ ] **HMR support** - Hot module replacement for .d.ts files during development.

- [ ] **Rollup compatibility** - Ensure plugin works with Rollup directly (Vite uses Rollup under the hood).

### Bun Plugin

- [ ] **Error handling** - `bun-plugin/src/index.ts` doesn't handle generation errors gracefully.

- [ ] **Incremental mode** - Add support for only regenerating changed files.

- [ ] **Build events** - Emit events for build tooling integration.

### Future Plugins

- [ ] **esbuild plugin** - Native esbuild integration.

- [ ] **webpack plugin** - For legacy webpack projects.

- [ ] **tsup integration** - Direct integration with tsup bundler.

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

- [ ] **`--validate` flag** - Validate generated .d.ts against TypeScript compiler.

- [x] **`--stats` flag** - Show statistics (files processed, declarations found, etc.). ✅ Implemented

- [x] **Exit codes** - Proper exit codes for different error conditions. ✅ 0=success, 1=all failed, 2=partial

- [ ] **Stdin support** - Accept TypeScript code from stdin.

- [x] **JSON output** - `--format json` for programmatic consumption. ✅ `--output-format json`

- [ ] **Parallel processing** - `--parallel` flag for multi-file processing.

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

- [ ] **Bundle size** - Analyze and optimize the distributed bundle size.

- [ ] **Tree-shakeable exports** - Ensure library is fully tree-shakeable.

- [ ] **CommonJS support** - Currently ESM only. Consider dual package support.

- [ ] **Node.js compatibility** - Abstract Bun-specific APIs for Node.js fallback.

---

## 🧪 Test Coverage Gaps

- [x] **Example 0012** - Test file exists in fixtures but not in test array. ✅ Already included

- [ ] **`checker.ts`** - Large fixture file excluded from tests.

- [ ] **Error scenarios** - No tests for malformed TypeScript input.

- [ ] **Edge case coverage** - `edge-cases.ts` fixture exists but verify all cases pass.

- [ ] **Plugin tests** - No tests for bun-plugin or vite-plugin.

- [ ] **CLI tests** - No integration tests for CLI commands.

- [ ] **Benchmark regression** - No CI integration for performance benchmarks.

---

## ⚡ Concurrency & Parallelism

- [ ] **Worker threads for file processing** - Process multiple files in parallel using Bun workers.

- [ ] **Async AST parsing** - TypeScript's `createSourceFile` is synchronous. Consider background parsing.

- [ ] **Streaming output** - Write .d.ts files as they're generated instead of waiting for all files.

- [ ] **File batching** - Group small files for batch processing to reduce overhead.

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

- The codebase uses Bun-specific APIs (`Bun.file`, `Bun.write`). Consider abstracting for Node.js compatibility if needed.
- Current architecture is single-threaded. Consider worker threads for parallel file processing.
- The vite-plugin is essentially a placeholder (`export const wip = true`).

---

*Last updated: November 25, 2025*
*Generated from codebase analysis of dtsx v0.9.9*
