/**
 * DtsGenerationConfig
 *
 * This is the configuration object for the DTS generation process.
 */
export declare interface DtsGenerationConfig {
  cwd: string
  root: string
  entrypoints: string[]
  outdir: string
  keepComments: boolean
  clean: boolean
  tsconfigPath: string
  verbose: boolean
}
/**
 * Regular expression patterns used throughout the module
 */
export declare interface RegexPatterns {
  readonly typeImport: RegExp
  readonly regularImport: RegExp
  readonly bracketOpen: RegExp
  readonly bracketClose: RegExp
  readonly functionReturn: RegExp
  readonly typeAnnotation: RegExp
  readonly asyncFunction: RegExp
  readonly genericParams: RegExp
  readonly functionParams: RegExp
  readonly functionReturnType: RegExp
  readonly destructuredParams: RegExp
  readonly typePattern: RegExp
  readonly valueReference: RegExp
  readonly typeReference: RegExp
  readonly functionName: RegExp
  readonly exportCleanup: RegExp
  readonly defaultExport: RegExp
  readonly complexType: RegExp
  readonly unionIntersection: RegExp
  readonly mappedType: RegExp
  readonly conditionalType: RegExp
  readonly genericConstraints: RegExp
  readonly functionOverload: RegExp
  readonly moduleDeclaration: RegExp
  readonly moduleAugmentation: RegExp
}
export declare interface ImportTrackingState {
  typeImports: Map<string, Set<string>>
  valueImports: Map<string, Set<string>>
  usedTypes: Set<string>
  usedValues: Set<string>
  exportedTypes: Set<string>
  exportedValues: Set<string>
  valueAliases: Map<string, string>
  importSources: Map<string, string>
  typeExportSources: Map<string, string>
  defaultExportValue?: string
}
export declare interface ProcessingState {
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
  currentScope: 'top' | 'function'
}
export declare interface MethodSignature {
  name: string
  async: boolean
  generics: string
  params: string
  returnType: string
}
/**
 * Represents property type information with support for nested structures
 */
export declare interface PropertyInfo {
  key: string
  value: string
  type: string
  nested?: PropertyInfo[]
  method?: MethodSignature
}
/**
 * Import statement metadata and tracking
 */
export declare interface ImportInfo {
  kind: 'type' | 'value' | 'mixed'
  usedTypes: Set<string>
  usedValues: Set<string>
  source: string
}
/**
 * Function signature components
 */
export declare interface FunctionSignature {
  name: string
  params: string
  returnType: string
  generics: string
}
export declare interface ProcessedMethod {
  name: string
  signature: string
}
/**
 * DtsGenerationOption
 *
 * This is the configuration object for the DTS generation process.
 */
export type DtsGenerationOption = Partial<DtsGenerationConfig>;
/**
 * DtsGenerationOptions
 *
 * This is the configuration object for the DTS generation process.
 */
export type DtsGenerationOptions = DtsGenerationOption | DtsGenerationOption[];
