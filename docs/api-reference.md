# API Reference

This document provides a comprehensive reference for the dtsx API.

## Core Functions

### `generate`

Generates TypeScript declaration files from source files.

```typescript
function generate(options?: Partial<DtsGenerationConfig>): Promise<void>
```

#### Parameters

- `options` (optional): `Partial<DtsGenerationConfig>` - Configuration options for generation

#### Example

```typescript
import { generate } from '@stacksjs/dtsx'

await generate({
  root: './src',
  outdir: './dist',
  clean: true,
  keepComments: true,
})
```

### `extractDeclarations`

Extracts type declarations from TypeScript source code.

```typescript
function extractDeclarations(sourceCode: string, filePath: string, keepComments?: boolean): Declaration[]
```

#### Parameters

- `sourceCode`: `string` - The TypeScript source code to analyze
- `filePath`: `string` - Path to the source file (for context)
- `keepComments` (optional): `boolean` - Whether to preserve comments (default: true)

#### Example

```typescript
import { extractDeclarations } from '@stacksjs/dtsx'

const sourceCode = 'export interface User { name: string }'
const declarations = extractDeclarations(sourceCode, './types.ts', true)
```

### `processDeclarations`

Processes extracted declarations into DTS format.

```typescript
function processDeclarations(declarations: Declaration[], context: ProcessingContext, keepComments?: boolean): string
```

#### Parameters

- `declarations`: `Declaration[]` - Array of extracted declarations
- `context`: `ProcessingContext` - Processing context with file information
- `keepComments` (optional): `boolean` - Whether to include comments (default: true)

### `processFile`

Processes a single TypeScript file and generates its DTS content.

```typescript
function processFile(filePath: string, config: DtsGenerationConfig): Promise<string>
```

#### Parameters

- `filePath`: `string` - Path to the TypeScript file to process
- `config`: `DtsGenerationConfig` - Configuration for processing

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

### `DtsGenerationOptions`

Union type for single or multiple configuration options.

```typescript
type DtsGenerationOptions = DtsGenerationOption | DtsGenerationOption[]
```

## Declaration Types

### `Declaration`

Represents a parsed declaration from TypeScript source.

```typescript
interface Declaration {
  kind: 'function' | 'variable' | 'interface' | 'type' | 'class' | 'enum' | 'import' | 'export' | 'module'
  name: string
  text: string
  leadingComments?: string[]
  isExported: boolean
  isDefault?: boolean
  typeAnnotation?: string
  modifiers?: string[]
  generics?: string
  extends?: string
  implements?: string[]
  members?: Declaration[]
  parameters?: ParameterDeclaration[]
  returnType?: string
  value?: any
  source?: string // for imports
  specifiers?: ImportSpecifier[] // for imports
  isTypeOnly?: boolean // for imports/exports
  isAsync?: boolean
  isGenerator?: boolean
  overloads?: string[] // for function overloads
  start?: number // AST node start position
  end?: number // AST node end position
}
```

### `ParameterDeclaration`

Interface for function parameters.

```typescript
interface ParameterDeclaration {
  name: string
  type?: string
  optional?: boolean
  rest?: boolean
  defaultValue?: string
}
```

### `ImportSpecifier`

Interface for import specifiers.

```typescript
interface ImportSpecifier {
  name: string
  alias?: string
  isType?: boolean
}
```

### `ProcessingContext`

Context passed through processing pipeline.

```typescript
interface ProcessingContext {
  filePath: string
  sourceCode: string
  declarations: Declaration[]
  imports: Map<string, Set<string>>
  exports: Set<string>
  usedTypes: Set<string>
}
```

## Parser Functions

### `removeLeadingComments`

Removes leading comments from text.

```typescript
function removeLeadingComments(text: string): string
```

### `extractLeadingComments`

Extracts leading comments from source code at a specific position.

```typescript
function extractLeadingComments(source: string, position: number): string[]
```

### `formatComments`

Formats comment arrays for output.

```typescript
function formatComments(comments: string[]): string[]
```

### `parseFunctionDeclaration`

Parses function declaration text into a structured format.

```typescript
interface FunctionSignature {
  name: string
  params: string
  returnType: string
  generics: string
}

function parseFunctionDeclaration(text: string): FunctionSignature | null
```

### `parseVariableDeclaration`

Parses variable declaration text.

```typescript
function parseVariableDeclaration(text: string): {
  name: string
  type: string
  kind: string
  isExported: boolean
}
```

## Utility Functions

### `writeToFile`

Writes content to a file using Bun's optimized file writing.

```typescript
function writeToFile(filePath: string, content: string): Promise<void>
```

### `getAllTypeScriptFiles`

Gets all TypeScript files in a directory recursively.

```typescript
function getAllTypeScriptFiles(directory?: string): Promise<string[]>
```

### `checkIsolatedDeclarations`

Checks if isolated declarations are enabled in tsconfig.

```typescript
function checkIsolatedDeclarations(options?: DtsGenerationConfig): Promise<boolean>
```

## Processing Functions

### Individual Declaration Processors

```typescript
function processFunctionDeclaration(decl: Declaration, keepComments?: boolean): string
function processVariableDeclaration(decl: Declaration, keepComments?: boolean): string
function processInterfaceDeclaration(decl: Declaration, keepComments?: boolean): string
function processTypeDeclaration(decl: Declaration, keepComments?: boolean): string
function processClassDeclaration(decl: Declaration, keepComments?: boolean): string
function processEnumDeclaration(decl: Declaration, keepComments?: boolean): string
function processImportDeclaration(decl: Declaration): string
function processExportDeclaration(decl: Declaration): string
function processModuleDeclaration(decl: Declaration, keepComments?: boolean): string
```

### Type Inference

```typescript
function inferNarrowType(value: any, isConst?: boolean): string
```

## Type Guards

### `isExportStatement`

Checks if a line is an export statement.

```typescript
function isExportStatement(line: string): boolean
```

### `isTypeOnlyExport`

Checks if an export is type-only.

```typescript
function isTypeOnlyExport(line: string): boolean
```

## Default Configuration

The library provides sensible defaults:

```typescript
const defaultConfig: DtsGenerationConfig = {
  cwd: process.cwd(),
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,
  tsconfigPath: './tsconfig.json',
  outputStructure: 'mirror',
  verbose: false,
}
```

## Best Practices

1. **Configuration**
   - Always specify `root` and `outdir` for clarity
   - Use `clean: true` for fresh builds
   - Enable `keepComments: true` for documentation preservation
   - Set appropriate `outputStructure` ('mirror' or 'flat')

2. **Type Processing**
   - Optionally enable `isolatedDeclarations` in tsconfig.json for a performance fast path
   - Use type-only imports when possible
   - Handle circular dependencies carefully
   - Validate type definitions before processing

3. **Comment Preservation**
   - Use JSDoc comments for comprehensive documentation
   - Include `@param`, `@returns`, and `@example` tags
   - Comments are preserved by default (`keepComments: true`)

4. **Error Handling**
   - Use try-catch blocks around generation calls
   - Validate input parameters and file paths
   - Handle file system errors gracefully
   - Provide helpful error messages to users

5. **Performance**
   - Use glob patterns efficiently in entrypoints
   - Consider output structure impact on build times
   - Enable verbose logging only when debugging
   - Clean output directory when structure changes
