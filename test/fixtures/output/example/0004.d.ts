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
export declare interface RegexPatterns {
  typeImport: RegExp
  regularImport: RegExp
  bracketOpen: RegExp
  bracketClose: RegExp
  functionReturn: RegExp
  typeAnnotation: RegExp
  asyncFunction: RegExp
  genericParams: RegExp
  functionParams: RegExp
  functionReturnType: RegExp
  destructuredParams: RegExp
  typePattern: RegExp
  valueReference: RegExp
  typeReference: RegExp
  functionName: RegExp
  exportCleanup: RegExp
  defaultExport: RegExp
  complexType: RegExp
  unionIntersection: RegExp
  mappedType: RegExp
  conditionalType: RegExp
  genericConstraints: RegExp
  functionOverload: RegExp
  moduleDeclaration: RegExp
  moduleAugmentation: RegExp
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
export declare interface PropertyInfo {
  key: string
  value: string
  type: string
  nested?: PropertyInfo[]
  method?: MethodSignature
}
export declare interface ImportInfo {
  kind: 'type' | 'value' | 'mixed'
  usedTypes: Set<string>
  usedValues: Set<string>
  source: string
}
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
export type DtsGenerationOption = Partial<DtsGenerationConfig>
export type DtsGenerationOptions = DtsGenerationOption | DtsGenerationOption[]