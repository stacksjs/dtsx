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
export declare type DtsGenerationOption = Partial<DtsGenerationConfig>

export type DtsGenerationOptions = DtsGenerationOption | DtsGenerationOption[]

export interface RegexPatterns {
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

export interface ImportTrackingState {
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
  currentScope: 'top' | 'function'
}

export interface MethodSignature {
  name: string
  async: boolean
  generics: string
  params: string
  returnType: string
}

export interface PropertyInfo {
  key: string
  value: string
  type: string
  nested?: PropertyInfo[]
  method?: MethodSignature
}

export interface ImportInfo {
  kind: 'type' | 'value' | 'mixed'
  usedTypes: Set<string>
  usedValues: Set<string>
  source: string
}

export interface FunctionSignature {
  name: string
  params: string
  returnType: string
  generics: string
}

export interface ProcessedMethod {
  name: string
  signature: string
}