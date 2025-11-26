# Contributing to dtsx

Thank you for your interest in contributing to dtsx! This guide will help you get started.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Adding New Features](#adding-new-features)
- [Fixing Bugs](#fixing-bugs)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- Git
- A code editor (VS Code recommended)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/dtsx.git
cd dtsx
```

3. Add the upstream remote:

```bash
git remote add upstream https://github.com/stacksjs/dtsx.git
```

## Development Setup

### Install Dependencies

```bash
bun install
```

### Build the Project

```bash
bun run build
```

### Run Tests

```bash
bun test
```

### Run a Single Test File

```bash
bun test test/generator.test.ts
```

## Project Structure

```
dtsx/
├── packages/
│   ├── dtsx/                 # Core library
│   │   ├── src/
│   │   │   ├── generator.ts  # Main generation entry point
│   │   │   ├── extractor.ts  # Declaration extraction
│   │   │   ├── processor.ts  # Declaration processing
│   │   │   ├── formatter.ts  # Output formatting
│   │   │   ├── bundler.ts    # Declaration bundling
│   │   │   ├── cache.ts      # Incremental build cache
│   │   │   ├── plugins.ts    # Plugin system
│   │   │   ├── lsp.ts        # Language server
│   │   │   └── ...
│   │   ├── test/
│   │   │   ├── fixtures/     # Test input/output files
│   │   │   └── *.test.ts     # Test files
│   │   └── bin/
│   │       └── cli.ts        # CLI entry point
│   ├── vite-plugin/          # Vite integration
│   ├── esbuild-plugin/       # esbuild integration
│   ├── webpack-plugin/       # webpack integration
│   └── bun-plugin/           # Bun integration
├── ARCHITECTURE.md           # Architecture documentation
├── TODO.md                   # Roadmap and tasks
└── ...
```

## Making Changes

### Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### Branch Naming Conventions

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test additions/improvements
- `perf/` - Performance improvements

## Testing

### Running Tests

```bash
# Run all tests
bun test

# Run with verbose output
bun test --verbose

# Run specific test file
bun test test/generator.test.ts

# Run tests matching a pattern
bun test --grep "should extract"
```

### Writing Tests

Tests use Bun's built-in test runner. Create test files in `packages/dtsx/test/`.

```typescript
// test/my-feature.test.ts
import { describe, expect, it } from 'bun:test'
import { myFunction } from '../src/my-module'

describe('myFunction', () => {
  it('should do something', () => {
    const result = myFunction('input')
    expect(result).toBe('expected')
  })

  it('should handle edge cases', () => {
    expect(() => myFunction(null)).toThrow()
  })
})
```

### Adding Test Fixtures

1. Add input files to `test/fixtures/input/example/`
2. Add expected output to `test/fixtures/output/`
3. Add the test case to `test/dts.test.ts`

```typescript
// In test/dts.test.ts
const testCases = [
  // ... existing cases
  '0099', // Your new test case
]
```

## Code Style

### General Guidelines

- Use TypeScript for all code
- Use meaningful variable and function names
- Keep functions small and focused
- Add JSDoc comments for public APIs
- Avoid `any` types when possible

### Formatting

The project uses ESLint for code formatting:

```bash
# Check formatting
bun run lint

# Fix formatting issues
bun run lint:fix
```

### Type Safety

- Enable strict mode in TypeScript
- Use explicit return types for public functions
- Avoid type assertions unless necessary

```typescript
// Good
export function extractType(source: string): TypeDeclaration | null {
  // ...
}

// Avoid
export function extractType(source: string) {
  return result as any
}
```

## Pull Request Process

### Before Submitting

1. **Ensure tests pass**: `bun test`
2. **Check linting**: `bun run lint`
3. **Update documentation** if needed
4. **Add tests** for new functionality

### PR Description Template

```markdown
## Summary
Brief description of changes

## Changes
- Change 1
- Change 2

## Testing
How to test these changes

## Related Issues
Fixes #123
```

### Review Process

1. Submit your PR
2. Maintainers will review within a few days
3. Address any requested changes
4. Once approved, your PR will be merged

## Adding New Features

### 1. Plan Your Feature

- Check [TODO.md](./TODO.md) for existing plans
- Open an issue to discuss large features
- Consider backward compatibility

### 2. Implement the Feature

Create a new module in `src/`:

```typescript
// src/my-feature.ts

/**
 * Configuration for my feature
 */
export interface MyFeatureConfig {
  option1: string
  option2?: boolean
}

/**
 * Main function description
 * @param input - Input description
 * @param config - Configuration options
 * @returns Output description
 */
export function myFeature(input: string, config: MyFeatureConfig): string {
  // Implementation
}
```

### 3. Export from Index

Add your export to `src/index.ts`:

```typescript
export * from './my-feature'
```

### 4. Add CLI Support (if applicable)

Update `bin/cli.ts`:

```typescript
case 'my-feature':
  await handleMyFeature(args)
  break
```

### 5. Write Tests

```typescript
// test/my-feature.test.ts
describe('myFeature', () => {
  it('should work with basic input', () => {
    // ...
  })
})
```

### 6. Update Documentation

- Add JSDoc comments
- Update README.md if needed
- Update TODO.md to mark as complete

## Fixing Bugs

### 1. Reproduce the Bug

Create a minimal reproduction:

```typescript
// In a test file
it('reproduces bug #123', () => {
  const input = `...`
  const result = processDeclarations(input, [], {})
  // This fails before the fix
  expect(result).not.toContain('incorrect output')
})
```

### 2. Find the Root Cause

- Use debugger or console.log
- Check related code paths
- Review recent changes

### 3. Implement the Fix

- Keep changes minimal
- Don't refactor unrelated code
- Add a regression test

### 4. Test Thoroughly

```bash
# Run all tests
bun test

# Run specific related tests
bun test --grep "related feature"
```

## Development Tips

### Debugging

Use Bun's debugger:

```bash
bun --inspect test/my-test.ts
```

Or add console.log statements:

```typescript
console.log('Debug:', JSON.stringify(value, null, 2))
```

### Performance Testing

Run benchmarks:

```bash
bun run benchmark.ts
bun run benchmark.ts --quick  # Faster, less accurate
```

### Working with the AST

The extractor uses TypeScript's compiler API:

```typescript
import ts from 'typescript'

const sourceFile = ts.createSourceFile(
  'file.ts',
  sourceCode,
  ts.ScriptTarget.Latest,
  true,
)

ts.forEachChild(sourceFile, (node) => {
  if (ts.isFunctionDeclaration(node)) {
    // Process function
  }
})
```

### Common Tasks

**Add a new declaration type:**

1. Update `DeclarationType` in `types.ts`
2. Add extraction logic in `extractor.ts`
3. Add processing logic in `processor.ts`
4. Add tests

**Add a new CLI command:**

1. Add case in `bin/cli.ts`
2. Implement handler function
3. Update help text
4. Add tests

**Add a new plugin hook:**

1. Add hook to `PluginHooks` interface in `plugins.ts`
2. Call hook at appropriate point in pipeline
3. Document in README

## Questions?

- Open a [GitHub Issue](https://github.com/stacksjs/dtsx/issues)
- Check existing issues for answers
- Review the [Architecture Guide](./ARCHITECTURE.md)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
