/**
 * DtsGenerationConfig
 *
 * This is the configuration object for the DTS generation process.
 */
export interface DtsGenerationConfig {
  cwd: string
  root: string
  entrypoints: string[]
  outdir: string
  keepComments: boolean
  clean: boolean
  tsconfigPath: string
  verbose: boolean | string[]
  /**
   * Output structure: 'mirror' to mirror src folders, 'flat' for flat output
   */
  outputStructure?: 'mirror' | 'flat'
  /**
   * Import order priority patterns. Imports matching earlier patterns appear first.
   * Use 'bun', 'node:', or any string to match against the import source.
   * @default ['bun']
   * @example ['node:', 'bun', '@myorg/']
   */
  importOrder?: string[]
  /**
   * Dry run mode - show what would be generated without writing files
   */
  dryRun?: boolean
  /**
   * Show statistics after generation (files processed, declarations found, etc.)
   */
  stats?: boolean
  /**
   * Continue processing other files if one file fails
   * @default false
   */
  continueOnError?: boolean
  /**
   * Log level for controlling output verbosity
   * @default 'info'
   */
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
  /**
   * Glob patterns to exclude from processing
   * @example ['**\/*.test.ts', '**\/__tests__/**']
   */
  exclude?: string[]
  /**
   * Output format: 'text' for human-readable, 'json' for machine-readable
   * @default 'text'
   */
  outputFormat?: 'text' | 'json'
  /**
   * Show progress during generation (file count)
   * @default false
   */
  progress?: boolean
  /**
   * Show diff of changes compared to existing .d.ts files
   * @default false
   */
  diff?: boolean
  /**
   * Validate generated .d.ts files against TypeScript compiler
   * @default false
   */
  validate?: boolean
  /**
   * Watch mode - regenerate on file changes
   * @default false
   */
  watch?: boolean
  /**
   * Process files in parallel for faster generation
   * @default false
   */
  parallel?: boolean
  /**
   * Number of concurrent workers for parallel processing
   * @default 4
   */
  concurrency?: number
  /**
   * Generate declaration map files (.d.ts.map) for source mapping
   * @default false
   */
  declarationMap?: boolean
}

/**
 * Source location for error reporting
 */
export interface SourceLocation {
  line: number
  column: number
  offset?: number
}

/**
 * Detailed error information with source location
 */
export interface DtsError {
  file: string
  message: string
  code?: string
  location?: SourceLocation
  stack?: string
  suggestion?: string
}

/**
 * Generation statistics
 */
export interface GenerationStats {
  filesProcessed: number
  filesGenerated: number
  filesFailed: number
  filesValidated: number
  validationErrors: number
  declarationsFound: number
  importsProcessed: number
  exportsProcessed: number
  durationMs: number
  errors: DtsError[]
}

/**
 * DtsGenerationOption
 *
 * This is the configuration object for the DTS generation process.
 */
export type DtsGenerationOption = Partial<DtsGenerationConfig>

/**
 * DtsGenerationOptions
 *
 * This is the configuration object for the DTS generation process.
 */
export type DtsGenerationOptions = DtsGenerationOption | DtsGenerationOption[]

/**
 * Declaration kind - all possible declaration types
 */
export type DeclarationKind = 'function' | 'variable' | 'interface' | 'type' | 'class' | 'enum' | 'import' | 'export' | 'module'

/**
 * Declaration
 *
 * Represents a parsed declaration from TypeScript source
 */
export interface Declaration {
  kind: DeclarationKind
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
  isSideEffect?: boolean // for side-effect imports like `import 'module'`
  isAsync?: boolean
  isGenerator?: boolean
  overloads?: string[] // for function overloads
  start?: number // AST node start position
  end?: number // AST node end position
}

/**
 * ParameterDeclaration
 */
export interface ParameterDeclaration {
  name: string
  type?: string
  optional?: boolean
  rest?: boolean
  defaultValue?: string
}

/**
 * ImportSpecifier
 */
export interface ImportSpecifier {
  name: string
  alias?: string
  isType?: boolean
}

/**
 * ProcessingContext
 *
 * Context passed through processing pipeline
 */
export interface ProcessingContext {
  filePath: string
  sourceCode: string
  declarations: Declaration[]
  imports: Map<string, Set<string>>
  exports: Set<string>
  usedTypes: Set<string>
}
