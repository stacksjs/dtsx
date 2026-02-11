# Advanced Topics

This section covers advanced topics and techniques for using dtsx effectively in complex scenarios.

## Type Processing

Learn about dtsx's advanced type processing capabilities:

- **[Type Processing](./type-processing.md)**: Deep dive into how dtsx processes TypeScript types
- **Complex Type Inference**: Handling nested, recursive, and conditional types
- **Type Relationship Tracking**: Maintaining type dependencies across files
- **Declaration Extraction**: Understanding the AST-based extraction process
- **Comment Preservation**: Advanced comment handling and formatting

## Performance & Optimization

Optimize dtsx for large codebases and complex projects:

- **[Performance](./performance.md)**: Performance optimization strategies and best practices
- **Import Optimization**: Advanced techniques for optimizing import statements
- **Memory Management**: Handling large codebases efficiently with Bun's runtime
- **File Processing**: Optimizing multi-file processing workflows
- **Output Structure**: Choosing the right output structure for your needs

## Integration & Automation

Integrate dtsx into your development workflow:

- **[Integration](./integration.md)**: Build system and CI/CD integration patterns
- **Build Tool Integration**: Webpack, Vite, Rollup, and other bundler integration
- **CI/CD Pipelines**: Automated declaration generation in continuous integration
- **Package.json Scripts**: Effective npm script configurations
- **Development Workflows**: Hot reloading and watch mode strategies

## Troubleshooting & Debugging

Solve common issues and debug complex scenarios:

- **[Troubleshooting](./troubleshooting.md)**: Common issues and their solutions
- **TypeScript Configuration**: Isolated declarations and tsconfig.json setup
- **Type Resolution**: Handling complex type resolution scenarios
- **Import/Export Issues**: Debugging import and export problems
- **Performance Debugging**: Identifying and fixing performance bottlenecks

## Configuration Patterns

Advanced configuration techniques:

### Multi-Package Monorepos
```typescript
// dts.config.ts
export default {
  entrypoints: [
    'packages/*/src/index.ts',
    'packages/*/src/types.ts'
  ],
  outputStructure: 'mirror',
  clean: true
}
```

### Selective Type Generation
```typescript
// Generate only specific modules
export default {
  entrypoints: [
    'src/public-api/**/*.ts',
    '!src/internal/**/*.ts'
  ]
}
```

### Custom Output Structures
```typescript
// Flat structure for libraries
export default {
  outputStructure: 'flat',
  outdir: './types'
}
```

## Best Practices

### Type Design
- Use explicit type annotations for public APIs
- Leverage JSDoc comments for comprehensive documentation
- dtsx infers narrow types automatically — explicit annotations are optional
- Avoid complex type computations in public interfaces

### Project Structure
- Organize types in dedicated files when appropriate
- Use barrel exports for clean public APIs
- Separate internal types from public interfaces
- Maintain consistent naming conventions

### Performance
- Use type-only imports when possible
- Minimize circular dependencies
- Consider output structure impact on bundle size
- Enable verbose logging only for debugging

### Documentation
- Include comprehensive JSDoc comments
- Use `@example` tags for usage examples
- Document complex type relationships
- Maintain up-to-date type documentation

## Advanced Use Cases

### Library Development
Creating type-safe libraries with comprehensive declaration files:

```typescript
// src/index.ts
/**
 * Main library interface
 * @example
 * const lib = new MyLibrary({ config: true })
 */
export class MyLibrary {
  constructor(options: LibraryOptions) {}
}

export type { LibraryOptions } from './types'
```

### API Client Generation
Generating types for API clients and SDKs:

```typescript
// Generate types for REST API responses
export interface ApiResponse<T = unknown> {
  data: T
  status: number
  message?: string
}
```

### Plugin Systems

Creating extensible plugin architectures with proper typing:

```typescript
// Plugin interface with proper type constraints
export interface Plugin<TConfig = Record<string, unknown>> {
  name: string
  config?: TConfig
  initialize(): Promise<void>
}
```
