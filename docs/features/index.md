# Features

dtsx provides a comprehensive set of features for generating TypeScript declaration files. Here are the key features:

## Core Features

- **🎯 Narrowest Possible Type Inference**: Infers exact literal types from values — `3000` not `number`, `readonly [1, 2, 3]` not `number[]`. No `isolatedDeclarations` required. [See comparison →](./type-inference.md)
- **⚡ Fast TypeScript Declaration Generation**: Generate `.d.ts` files quickly and efficiently using Bun's optimized runtime
- **🔧 Smart Import Optimization**: Automatically optimizes imports based on actual usage and removes unused imports
- **💬 Comment Preservation**: Maintains JSDoc and other documentation comments in generated declarations (enabled by default)
- **📝 Multi-line Type Formatting**: Properly formats complex multi-line type definitions with correct indentation
- **🏗️ Flexible Output Structure**: Choose between mirroring source structure or flat output organization

## Type Support

dtsx supports all TypeScript declaration types:

### Basic Types
- **Interfaces and Type Aliases**: Full support with generics, extends, and complex inheritance
- **Functions and Methods**: Including overloads, generics, async functions, and generators
- **Classes**: With constructors, methods, properties, inheritance, and access modifiers
- **Enums**: Both numeric and string enums with member comments
- **Variables**: const, let, var declarations with proper type inference

### Advanced Types
- **Modules and Namespaces**: Nested declarations and proper scoping
- **Generics**: Type parameters, constraints, and default types
- **Union/Intersection Types**: Complex type combinations
- **Conditional Types**: Type-level conditionals and mappings
- **Mapped Types**: Property transformations and key remapping
- **Template Literal Types**: String manipulation at type level
- **Utility Types**: Built-in and custom utility type support

### Import/Export Handling
- **ES6 Imports/Exports**: Named, default, and namespace imports
- **Type-only Imports**: Proper handling of `import type` statements
- **Re-exports**: Export forwarding and barrel exports
- **Dynamic Imports**: Type-safe dynamic import declarations

## Configuration Options

### Core Configuration
- **Source Root Directory**: Configurable source directory (`root`)
- **Entry Point Specification**: Glob patterns for flexible file selection (`entrypoints`)
- **Output Directory Control**: Customizable output location (`outdir`)
- **Working Directory**: Configurable current working directory (`cwd`)

### Generation Options
- **Comment Preservation**: Toggle JSDoc and comment preservation (`keepComments`)
- **Clean Output**: Automatic cleanup of output directory (`clean`)
- **Output Structure**: Mirror source structure or flat output (`outputStructure`)
- **TypeScript Configuration**: Custom tsconfig.json path (`tsconfigPath`)

### Development Options
- **Verbose Logging**: Detailed generation logs for debugging (`verbose`)
- **Isolated Declarations**: Optional fast path — dtsx works great without it
- **Error Handling**: Comprehensive error reporting and validation

## Comment Preservation

When `keepComments: true` (default), dtsx preserves:

### JSDoc Comments
```typescript
/**
 * User interface with comprehensive documentation
 * @example
 * const user: User = { name: "John", age: 30 }
 */
export interface User {
  /** User's full name */
  name: string
  /** User's age in years */
  age: number
}
```

### Documentation Tags
- `@param` - Parameter descriptions
- `@returns` - Return value documentation
- `@example` - Usage examples
- `@deprecated` - Deprecation notices
- `@author` - Author information
- `@version` - Version information
- `@see` - Cross-references
- `@throws` - Exception documentation
- `@template` - Generic type documentation

### Comment Types
- **Block Comments**: `/* ... */`
- **Single-line Comments**: `//`
- **Multi-line Documentation**: Proper formatting preservation

## Performance Features

### Optimized Processing
- **Bun Runtime**: Leverages Bun's fast JavaScript runtime
- **TypeScript AST**: Direct TypeScript compiler API usage
- **Minimal Dependencies**: Lightweight with focused functionality
- **Efficient File I/O**: Optimized file reading and writing

### Smart Analysis
- **Selective Processing**: Only processes exported declarations
- **Dependency Tracking**: Tracks type dependencies and relationships
- **Circular Reference Handling**: Proper handling of circular type dependencies
- **Tree Shaking**: Removes unused type definitions

## CLI Features

### Command Structure
- **Default Command**: Simple `dtsx` for quick generation
- **Explicit Commands**: `dtsx generate` for clarity
- **Version Command**: `dtsx version` for version info
- **Help System**: Comprehensive help with examples

### Option Handling
- **Boolean Flags**: `--clean`, `--verbose`, `--keep-comments`
- **Value Options**: `--root`, `--outdir`, `--entrypoints`
- **Path Resolution**: Automatic path resolution and validation
- **Configuration Override**: CLI options override config files

## Integration Features

### Build Tool Integration
- **Package.json Scripts**: Easy integration with npm scripts
- **CI/CD Support**: Suitable for automated build pipelines
- **Watch Mode**: File watching capabilities (future feature)
- **Incremental Builds**: Smart rebuilding (future feature)

### Configuration Management
- **Config Files**: `dts.config.ts` and `dts.config.js` support
- **Environment Variables**: Environment-based configuration
- **Default Values**: Sensible defaults for all options
- **Validation**: Configuration validation and error reporting

## Quality Features

### Type Safety
- **Narrow Type Inference**: Infers the narrowest possible types from values automatically
- **Type Validation**: Ensures type correctness in output
- **Import Resolution**: Proper import path resolution
- **Export Tracking**: Tracks all exports and their usage

### Error Handling
- **Graceful Failures**: Continues processing on individual file errors
- **Detailed Errors**: Comprehensive error messages with context
- **Validation**: Input validation and early error detection
- **Recovery**: Attempts to recover from parsing errors

## Future Features

### Planned Enhancements
- **Watch Mode**: File watching for development
- **Incremental Builds**: Only rebuild changed files
- **Plugin System**: Extensible plugin architecture
- **Custom Transformers**: User-defined type transformations
- **Bundle Analysis**: Dependency analysis and optimization
- **Source Maps**: Source map generation for debugging

### Community Features
- **VS Code Extension**: Editor integration
- **Language Server**: Enhanced IDE support
- **Documentation Generation**: Automatic docs from types
- **Type Checking**: Enhanced type validation
