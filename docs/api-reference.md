# API Reference

This document provides a comprehensive reference for the dtsx API.

## Core Functions

### `generate`

Generates TypeScript declaration files from source files.

```typescript
function generate(options?: DtsGenerationOption): Promise<void>
```

#### Parameters

- `options` (optional): `DtsGenerationOption` - Configuration options for generation

#### Example

```typescript
import { generate } from 'dtsx'

await generate({
  root: './src',
  outdir: './dist',
  clean: true,
})
```

### `extract`

Extracts type information from a TypeScript file.

```typescript
function extract(filePath: string, verbose?: boolean | string[]): Promise<string>
```

#### Parameters

- `filePath`: `string` - Path to the source TypeScript file
- `verbose` (optional): `boolean | string[]` - Enable verbose logging

#### Example

```typescript
import { extract } from 'dtsx'

const declarations = await extract('./src/index.ts', true)
```

## Configuration Types

### `DtsGenerationConfig`

Main configuration interface for dtsx.

```typescript
interface DtsGenerationConfig {
  /** Current working directory */
  cwd: string
  /** Source root directory */
  root: string
  /** Entry point patterns */
  entrypoints: string[]
  /** Output directory */
  outdir: string
  /** Preserve comments in output */
  keepComments: boolean
  /** Clean output directory before generation */
  clean: boolean
  /** Path to tsconfig.json */
  tsconfigPath: string
  /** Enable verbose logging */
  verbose: boolean | string[]
  /** Output structure: 'mirror' to mirror src folders, 'flat' for flat output */
  outputStructure?: 'mirror' | 'flat'
}
```

### `DtsGenerationOption`

Partial configuration options.

```typescript
type DtsGenerationOption = Partial<DtsGenerationConfig>
```

## Type Processing

### `ProcessingState`

State interface for type processing.

```typescript
interface ProcessingState {
  /** Generated declaration lines */
  dtsLines: string[]
  /** Import statements */
  imports: string[]
  /** Used type names */
  usedTypes: Set<string>
  /** Type source mapping */
  typeSources: Map<string, string>
  /** Default export value */
  defaultExport: string | null
  /** Export all statements */
  exportAllStatements: string[]
  /** Current declaration being processed */
  currentDeclaration: string
  /** Last comment block */
  lastCommentBlock: string
  /** Bracket nesting level */
  bracketCount: number
  /** Multi-line declaration flag */
  isMultiLineDeclaration: boolean
  /** Module imports */
  moduleImports: Map<string, ImportInfo>
  /** Available types */
  availableTypes: Map<string, string>
  /** Available values */
  availableValues: Map<string, string>
  /** Current indentation */
  currentIndentation: string
  /** Declaration buffer */
  declarationBuffer: {
    type: 'interface' | 'type' | 'const' | 'function' | 'import' | 'export'
    indent: string
    lines: string[]
    comments: string[]
  } | null
  /** Import tracking state */
  importTracking: ImportTrackingState
  /** Default exports */
  defaultExports: Set<string>
  /** Current scope */
  currentScope: 'top' | 'function'
}
```

### `ImportTrackingState`

State interface for import tracking.

```typescript
interface ImportTrackingState {
  /** Type imports mapping */
  typeImports: Map<string, Set<string>>
  /** Value imports mapping */
  valueImports: Map<string, Set<string>>
  /** Used type names */
  usedTypes: Set<string>
  /** Used value names */
  usedValues: Set<string>
  /** Exported type names */
  exportedTypes: Set<string>
  /** Exported value names */
  exportedValues: Set<string>
  /** Value alias mapping */
  valueAliases: Map<string, string>
  /** Import source mapping */
  importSources: Map<string, string>
  /** Type export source mapping */
  typeExportSources: Map<string, string>
  /** Default export value */
  defaultExportValue?: string
}
```

## Type Definitions

### `FunctionSignature`

Interface for function signatures.

```typescript
interface FunctionSignature {
  /** Function name */
  name: string
  /** Function parameters */
  params: string
  /** Return type */
  returnType: string
  /** Generic type parameters */
  generics: string
}
```

### `PropertyInfo`

Interface for property information.

```typescript
interface PropertyInfo {
  /** Property key */
  key: string
  /** Original value */
  value: string
  /** Inferred type */
  type: string
  /** Nested properties */
  nested?: PropertyInfo[]
  /** Method signature */
  method?: MethodSignature
}
```

### `MethodSignature`

Interface for method signatures.

```typescript
interface MethodSignature {
  /** Method name */
  name: string
  /** Async flag */
  async: boolean
  /** Generic type parameters */
  generics: string
  /** Method parameters */
  params: string
  /** Return type */
  returnType: string
}
```

## Utility Functions

### `writeToFile`

Writes content to a file.

```typescript
function writeToFile(filePath: string, content: string): Promise<void>
```

### `getAllTypeScriptFiles`

Gets all TypeScript files in a directory.

```typescript
function getAllTypeScriptFiles(directory?: string): Promise<string[]>
```

### `checkIsolatedDeclarations`

Checks if isolated declarations are enabled in tsconfig.

```typescript
function checkIsolatedDeclarations(options?: DtsGenerationConfig): Promise<boolean>
```

## Type Guards

### `isFunctionType`

Checks if a type is a function type.

```typescript
function isFunctionType(type: string): boolean
```

### `isDeclarationComplete`

Checks if a declaration is complete.

```typescript
function isDeclarationComplete(content: string | string[]): boolean
```

## Best Practices

1. **Configuration**
   - Always specify `root` and `outdir`
   - Use `clean: true` for fresh builds
   - Enable `keepComments` for documentation
   - Set appropriate `outputStructure`

2. **Type Processing**
   - Use type guards for safety
   - Handle circular dependencies
   - Track type relationships
   - Validate type definitions

3. **Import Management**
   - Use type-only imports when possible
   - Consolidate imports
   - Remove unused imports
   - Handle namespace imports

4. **Error Handling**
   - Use try-catch blocks
   - Validate input parameters
   - Handle file system errors
   - Provide helpful error messages
