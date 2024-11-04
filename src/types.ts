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
 * Regular expression patterns used throughout the module
 */
export interface RegexPatterns {
  /** Import type declarations */
  readonly typeImport: RegExp
  /** Regular import declarations */
  readonly regularImport: RegExp
  /** Opening brackets and braces */
  readonly bracketOpen: RegExp
  /** Closing brackets and braces */
  readonly bracketClose: RegExp
  /** Function return statements */
  readonly functionReturn: RegExp
  /** Type annotation patterns */
  readonly typeAnnotation: RegExp
  /** Async function declarations */
  readonly asyncFunction: RegExp
  /** Generic type parameters */
  readonly genericParams: RegExp
  /** Function parameter block */
  readonly functionParams: RegExp
  /** Return type declaration */
  readonly functionReturnType: RegExp
  /** Destructured parameters */
  readonly destructuredParams: RegExp
  /** Type pattern matching */
  readonly typePattern: RegExp
  /** Value reference pattern */
  readonly valueReference: RegExp
  /** Type reference pattern */
  readonly typeReference: RegExp
  /** Function name extraction */
  readonly functionName: RegExp
  /** Export statement cleanup */
  readonly exportCleanup: RegExp
  /** Default export */
  readonly defaultExport: RegExp
  /** Named export */
  readonly complexType: RegExp
  /** Union and intersection types */
  readonly unionIntersection: RegExp
  /** Conditional types */
  readonly mappedType: RegExp
  /** Conditional types */
  readonly conditionalType: RegExp
  /** Generic constraints */
  readonly genericConstraints: RegExp
  /** Function overload */
  readonly functionOverload: RegExp
  /** Module declaration pattern */
  readonly moduleDeclaration: RegExp
  /** Module augmentation pattern */
  readonly moduleAugmentation: RegExp
}

export interface ImportTrackingState {
  typeImports: Map<string, Set<string>> // module -> Set of type names
  valueImports: Map<string, Set<string>> // module -> Set of value names
  usedTypes: Set<string> // All used type names
  usedValues: Set<string> // All used value names
  exportedValues: Set<string> // Values that are exported
  valueAliases: Map<string, string> // alias -> original name mapping
  importSources: Map<string, string> // name -> module mapping
  defaultExportValue?: string // The value being default exported
}

export interface ProcessingState {
  dtsLines: string[]
  imports: string[]
  usedTypes: Set<string>
  typeSources: Map<string, string>
  defaultExport: string | null
  exportAllStatements: string[]
  currentDeclaration: string
  lastCommentBlock: string
  bracketCount: number
  isMultiLineDeclaration: boolean
  moduleImports: Map<string, ImportInfo>
  availableTypes: Map<string, string>
  availableValues: Map<string, string>
  currentIndentation: string
  declarationBuffer: {
    type: 'interface' | 'type' | 'const' | 'function' | 'import' | 'export'
    indent: string
    lines: string[]
    comments: string[]
  } | null
  importTracking: ImportTrackingState
  defaultExports: Set<string>
  debug: {
    exports: {
      default: string[]
      named: string[]
      all: string[]
    }
    declarations: string[]
    currentProcessing: string
  }
  currentScope: 'top' | 'function'
}

export interface MethodSignature {
  name: string
  async: boolean
  generics: string
  params: string
  returnType: string
}

/**
 * Represents property type information with support for nested structures
 */
export interface PropertyInfo {
  /** Property identifier */
  key: string
  /** Original source value */
  value: string
  /** Inferred TypeScript type */
  type: string
  /** Nested property definitions */
  nested?: PropertyInfo[]
  method?: MethodSignature
}

/**
 * Import statement metadata and tracking
 */
export interface ImportInfo {
  /** Import kind: type, value, or mixed */
  kind: 'type' | 'value' | 'mixed'
  /** Set of used type imports */
  usedTypes: Set<string>
  /** Set of used value imports */
  usedValues: Set<string>
  /** Source module path */
  source: string
}

/**
 * Function signature components
 */
export interface FunctionSignature {
  name: string
  params: string
  returnType: string
  generics: string
}
