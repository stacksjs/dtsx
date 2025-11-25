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
 * Declaration
 *
 * Represents a parsed declaration from TypeScript source
 */
export interface Declaration {
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
