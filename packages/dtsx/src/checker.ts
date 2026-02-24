import type { DtsGenerationConfig } from './types'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

/**
 * Diagnostic severity levels
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'

/**
 * A diagnostic message from type checking
 */
export interface TypeDiagnostic {
  /** File path */
  file: string
  /** Line number (1-indexed) */
  line: number
  /** Column number (1-indexed) */
  column: number
  /** Diagnostic message */
  message: string
  /** Diagnostic code (TS error code) */
  code: number
  /** Severity level */
  severity: DiagnosticSeverity
  /** Source text around the error */
  source?: string
  /** Suggested fix if available */
  suggestion?: string
  /** Category of the diagnostic */
  category: string
}

/**
 * Result of type checking
 */
export interface TypeCheckResult {
  /** Whether type checking passed (no errors) */
  success: boolean
  /** All diagnostics found */
  diagnostics: TypeDiagnostic[]
  /** Count by severity */
  errorCount: number
  warningCount: number
  infoCount: number
  /** Files that were checked */
  filesChecked: string[]
  /** Duration of type checking in ms */
  durationMs: number
}

/**
 * Type checking configuration
 */
export interface TypeCheckConfig {
  /** Path to tsconfig.json */
  tsconfigPath?: string
  /** Root directory for resolution */
  rootDir?: string
  /** Strict mode (more checking) */
  strict?: boolean
  /** Check .d.ts files only */
  declarationsOnly?: boolean
  /** Skip library checking */
  skipLibCheck?: boolean
  /** Include specific files only */
  include?: string[]
  /** Exclude patterns */
  exclude?: string[]
  /** Report warnings as errors */
  warningsAsErrors?: boolean
  /** Maximum number of errors before stopping */
  maxErrors?: number
  /** Custom compiler options to override */
  compilerOptions?: Partial<ts.CompilerOptions>
}

/**
 * Isolated declarations checking result
 */
export interface IsolatedDeclarationsResult {
  /** Whether the file is compatible with isolatedDeclarations */
  compatible: boolean
  /** Issues found */
  issues: IsolatedDeclarationsIssue[]
}

/**
 * An issue found during isolated declarations checking
 */
export interface IsolatedDeclarationsIssue {
  /** Location in the file */
  line: number
  column: number
  /** Description of the issue */
  message: string
  /** Name of the declaration with the issue */
  declarationName?: string
  /** The missing type annotation */
  missingAnnotation?: 'return' | 'parameter' | 'variable' | 'property'
}

/**
 * Load TypeScript compiler options from tsconfig.json
 */
export function loadCompilerOptions(
  tsconfigPath: string,
  overrides?: Partial<ts.CompilerOptions>,
): ts.CompilerOptions {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)

  if (configFile.error) {
    throw new Error(`Error reading tsconfig.json: ${formatDiagnostic(configFile.error)}`)
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    dirname(tsconfigPath),
  )

  if (parsedConfig.errors.length > 0) {
    const errorMessages = parsedConfig.errors.map(formatDiagnostic).join('\n')
    throw new Error(`Error parsing tsconfig.json:\n${errorMessages}`)
  }

  return {
    ...parsedConfig.options,
    ...overrides,
  }
}

/**
 * Format a TypeScript diagnostic to a string
 */
function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    return `${diagnostic.file.fileName}(${line + 1},${character + 1}): ${message}`
  }
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
}

/**
 * Convert TypeScript diagnostic category to severity
 */
function categoryToSeverity(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 'error'
    case ts.DiagnosticCategory.Warning:
      return 'warning'
    case ts.DiagnosticCategory.Suggestion:
      return 'hint'
    case ts.DiagnosticCategory.Message:
    default:
      return 'info'
  }
}

/**
 * Get category name from TypeScript diagnostic category
 */
function getCategoryName(category: ts.DiagnosticCategory): string {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return 'Error'
    case ts.DiagnosticCategory.Warning:
      return 'Warning'
    case ts.DiagnosticCategory.Suggestion:
      return 'Suggestion'
    case ts.DiagnosticCategory.Message:
      return 'Message'
    default:
      return 'Unknown'
  }
}

/**
 * Convert a TypeScript diagnostic to our TypeDiagnostic format
 */
function convertDiagnostic(diagnostic: ts.Diagnostic): TypeDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')

  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    const sourceFile = diagnostic.file

    // Get source context
    let source: string | undefined
    if (diagnostic.length) {
      const startLine = line
      const endPos = diagnostic.start + diagnostic.length
      const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(endPos)

      const lines = sourceFile.text.split('\n')
      const contextStart = Math.max(0, startLine - 1)
      const contextEnd = Math.min(lines.length, endLine + 2)
      source = lines.slice(contextStart, contextEnd).join('\n')
    }

    return {
      file: sourceFile.fileName,
      line: line + 1,
      column: character + 1,
      message,
      code: diagnostic.code,
      severity: categoryToSeverity(diagnostic.category),
      source,
      category: getCategoryName(diagnostic.category),
    }
  }

  return {
    file: '<unknown>',
    line: 0,
    column: 0,
    message,
    code: diagnostic.code,
    severity: categoryToSeverity(diagnostic.category),
    category: getCategoryName(diagnostic.category),
  }
}

/**
 * Create a TypeScript program for type checking
 */
function createProgram(
  files: string[],
  compilerOptions: ts.CompilerOptions,
): ts.Program {
  const host = ts.createCompilerHost(compilerOptions)
  return ts.createProgram(files, compilerOptions, host)
}

/**
 * Type check TypeScript/declaration files
 */
export async function typeCheck(
  files: string[],
  config: TypeCheckConfig = {},
): Promise<TypeCheckResult> {
  const startTime = Date.now()

  // Load compiler options
  let compilerOptions: ts.CompilerOptions

  if (config.tsconfigPath) {
    compilerOptions = loadCompilerOptions(config.tsconfigPath, config.compilerOptions)
  }
  else {
    compilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: config.strict ?? true,
      skipLibCheck: config.skipLibCheck ?? true,
      noEmit: true,
      declaration: true,
      ...config.compilerOptions,
    }
  }

  // Filter files if needed
  let filesToCheck = files

  if (config.declarationsOnly) {
    filesToCheck = files.filter(f => f.endsWith('.d.ts'))
  }

  if (config.include?.length) {
    const includePatterns = config.include.map(p => new RegExp(p.replace(/\*/g, '.*')))
    filesToCheck = filesToCheck.filter(f => includePatterns.some(p => p.test(f)))
  }

  if (config.exclude?.length) {
    const excludePatterns = config.exclude.map(p => new RegExp(p.replace(/\*/g, '.*')))
    filesToCheck = filesToCheck.filter(f => !excludePatterns.some(p => p.test(f)))
  }

  // Create program and get diagnostics
  const program = createProgram(filesToCheck, compilerOptions)

  const allDiagnostics: ts.Diagnostic[] = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getDeclarationDiagnostics(),
  ]

  // Convert diagnostics
  let diagnostics = allDiagnostics.map(convertDiagnostic)

  // Apply max errors limit
  if (config.maxErrors && diagnostics.length > config.maxErrors) {
    diagnostics = diagnostics.slice(0, config.maxErrors)
  }

  // Calculate counts
  let errorCount = diagnostics.filter(d => d.severity === 'error').length
  const warningCount = diagnostics.filter(d => d.severity === 'warning').length
  const infoCount = diagnostics.filter(d => d.severity === 'info' || d.severity === 'hint').length

  // Handle warnings as errors
  if (config.warningsAsErrors) {
    diagnostics = diagnostics.map(d =>
      d.severity === 'warning' ? { ...d, severity: 'error' as const } : d,
    )
    errorCount += warningCount
  }

  return {
    success: errorCount === 0,
    diagnostics,
    errorCount,
    warningCount: config.warningsAsErrors ? 0 : warningCount,
    infoCount,
    filesChecked: filesToCheck,
    durationMs: Date.now() - startTime,
  }
}

/**
 * Validate that generated .d.ts files are valid TypeScript
 */
export async function validateDeclarations(
  dtsFiles: string[],
  config: TypeCheckConfig = {},
): Promise<TypeCheckResult> {
  return typeCheck(dtsFiles, {
    ...config,
    declarationsOnly: true,
    skipLibCheck: true,
    compilerOptions: {
      ...config.compilerOptions,
      noEmit: true,
      declaration: false, // Already .d.ts files
    },
  })
}

/**
 * Check if source files are compatible with TypeScript's isolatedDeclarations mode
 */
export async function checkIsolatedDeclarations(
  files: string[],
  tsconfigPath?: string,
): Promise<Map<string, IsolatedDeclarationsResult>> {
  const results = new Map<string, IsolatedDeclarationsResult>()

  // Load compiler options with isolatedDeclarations enabled
  const baseOptions: ts.CompilerOptions = tsconfigPath
    ? loadCompilerOptions(tsconfigPath)
    : {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      }

  const compilerOptions: ts.CompilerOptions = {
    ...baseOptions,
    isolatedDeclarations: true,
    declaration: true,
    noEmit: true,
  }

  const program = createProgram(files, compilerOptions)

  for (const file of files) {
    const sourceFile = program.getSourceFile(file)
    if (!sourceFile) {
      results.set(file, { compatible: true, issues: [] })
      continue
    }

    const issues: IsolatedDeclarationsIssue[] = []

    // Get diagnostics for this file
    const diagnostics = [
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    ]

    // Filter for isolatedDeclarations-related errors (TS9006, TS9007, etc.)
    const isolatedDeclErrors = diagnostics.filter(
      d => d.code >= 9006 && d.code <= 9099,
    )

    for (const diag of isolatedDeclErrors) {
      if (diag.start !== undefined) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(diag.start)
        const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n')

        // Try to determine what kind of annotation is missing
        let missingAnnotation: IsolatedDeclarationsIssue['missingAnnotation']
        if (message.includes('return type'))
          missingAnnotation = 'return'
        else if (message.includes('parameter'))
          missingAnnotation = 'parameter'
        else if (message.includes('variable'))
          missingAnnotation = 'variable'
        else if (message.includes('property'))
          missingAnnotation = 'property'

        issues.push({
          line: line + 1,
          column: character + 1,
          message,
          missingAnnotation,
        })
      }
    }

    results.set(file, {
      compatible: issues.length === 0,
      issues,
    })
  }

  return results
}

/**
 * Get type information for a specific position in a file
 */
export function getTypeAtPosition(
  filePath: string,
  line: number,
  column: number,
  tsconfigPath?: string,
): string | null {
  try {
    const compilerOptions: ts.CompilerOptions = tsconfigPath
      ? loadCompilerOptions(tsconfigPath)
      : {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        }

    const program = createProgram([filePath], compilerOptions)
    const sourceFile = program.getSourceFile(filePath)

    if (!sourceFile)
      return null

    // Check bounds before calling TypeScript API
    const lineCount = sourceFile.getLineStarts().length
    if (line < 1 || line > lineCount)
      return null

    const lineStart = sourceFile.getLineStarts()[line - 1]
    const lineEnd = line < lineCount
      ? sourceFile.getLineStarts()[line]
      : sourceFile.text.length

    if (column < 1 || column > lineEnd - lineStart)
      return null

    const pos = sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1)
    const checker = program.getTypeChecker()

    // Find the node at the position
    function findNode(node: ts.Node): ts.Node | undefined {
      if (pos >= node.getStart() && pos < node.getEnd()) {
        return ts.forEachChild(node, findNode) || node
      }
      return undefined
    }

    const node = findNode(sourceFile)
    if (!node)
      return null

    const type = checker.getTypeAtLocation(node)
    return checker.typeToString(type)
  }
  catch {
    return null
  }
}

/**
 * Get quick info (hover information) for a position
 */
export function getQuickInfo(
  filePath: string,
  line: number,
  column: number,
  tsconfigPath?: string,
): { type: string, documentation?: string } | null {
  try {
    const compilerOptions: ts.CompilerOptions = tsconfigPath
      ? loadCompilerOptions(tsconfigPath)
      : {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        }

    const program = createProgram([filePath], compilerOptions)
    const sourceFile = program.getSourceFile(filePath)

    if (!sourceFile)
      return null

    // Check bounds before calling TypeScript API
    const lineCount = sourceFile.getLineStarts().length
    if (line < 1 || line > lineCount)
      return null

    const lineStart = sourceFile.getLineStarts()[line - 1]
    const lineEnd = line < lineCount
      ? sourceFile.getLineStarts()[line]
      : sourceFile.text.length

    if (column < 1 || column > lineEnd - lineStart)
      return null

    const pos = sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1)
    const checker = program.getTypeChecker()

    // Find the node at the position
    function findNode(node: ts.Node): ts.Node | undefined {
      if (pos >= node.getStart() && pos < node.getEnd()) {
        return ts.forEachChild(node, findNode) || node
      }
      return undefined
    }

    const node = findNode(sourceFile)
    if (!node)
      return null

    const symbol = checker.getSymbolAtLocation(node)
    if (!symbol) {
      const type = checker.getTypeAtLocation(node)
      return { type: checker.typeToString(type) }
    }

    const type = checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, node))
    const documentation = ts.displayPartsToString(symbol.getDocumentationComment(checker))

    return {
      type,
      documentation: documentation || undefined,
    }
  }
  catch {
    return null
  }
}

/**
 * Format type check results as a human-readable string
 */
export function formatTypeCheckResults(result: TypeCheckResult): string {
  const lines: string[] = []

  if (result.success) {
    lines.push(`✓ Type check passed (${result.filesChecked.length} files checked in ${result.durationMs}ms)`)
  }
  else {
    lines.push(`✗ Type check failed`)
    lines.push(`  ${result.errorCount} error(s), ${result.warningCount} warning(s)`)
    lines.push('')

    for (const diagnostic of result.diagnostics) {
      const icon = diagnostic.severity === 'error' ? '✗' : diagnostic.severity === 'warning' ? '⚠' : 'ℹ'
      lines.push(`${icon} ${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`)
      lines.push(`  ${diagnostic.message}`)

      if (diagnostic.source) {
        const sourceLines = diagnostic.source.split('\n')
        for (const sl of sourceLines) {
          lines.push(`  │ ${sl}`)
        }
      }

      if (diagnostic.suggestion) {
        lines.push(`  💡 ${diagnostic.suggestion}`)
      }

      lines.push('')
    }
  }

  return lines.join('\n')
}

/**
 * Integrate type checking into DTS generation config
 */
export async function typeCheckWithConfig(
  config: DtsGenerationConfig,
): Promise<TypeCheckResult> {
  const files = config.entrypoints.map(f => resolve(config.cwd, f))

  return typeCheck(files, {
    tsconfigPath: config.tsconfigPath,
    rootDir: config.root,
  })
}

/**
 * Validate generated declarations match the source types
 */
export async function validateGeneratedDeclarations(
  _sourceFiles: string[],
  _dtsFiles: string[],
  _tsconfigPath?: string,
): Promise<{
    valid: boolean
    mismatches: Array<{
      sourceName: string
      sourceType: string
      dtsType: string
    }>
  }> {
  const sourceFiles = _sourceFiles
  const dtsFiles = _dtsFiles
  const tsconfigPath = _tsconfigPath
  const mismatches: Array<{
    sourceName: string
    sourceType: string
    dtsType: string
  }> = []

  // Create programs for both source and declarations
  const compilerOptions: ts.CompilerOptions = tsconfigPath
    ? loadCompilerOptions(tsconfigPath)
    : {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      }

  const sourceProgram = createProgram(sourceFiles, compilerOptions)
  const dtsProgram = createProgram(dtsFiles, { ...compilerOptions, declaration: false })

  const sourceChecker = sourceProgram.getTypeChecker()
  const dtsChecker = dtsProgram.getTypeChecker()

  // Compare exported symbols
  for (let i = 0; i < sourceFiles.length; i++) {
    const sourceFile = sourceProgram.getSourceFile(sourceFiles[i])
    const dtsFile = dtsProgram.getSourceFile(dtsFiles[i])

    if (!sourceFile || !dtsFile)
      continue

    const sourceSymbol = sourceChecker.getSymbolAtLocation(sourceFile)
    const dtsSymbol = dtsChecker.getSymbolAtLocation(dtsFile)

    if (!sourceSymbol || !dtsSymbol)
      continue

    const sourceExports = sourceChecker.getExportsOfModule(sourceSymbol)
    const dtsExports = dtsChecker.getExportsOfModule(dtsSymbol)

    const dtsExportMap = new Map(dtsExports.map(e => [e.getName(), e]))

    for (const sourceExport of sourceExports) {
      const name = sourceExport.getName()
      const dtsExport = dtsExportMap.get(name)

      if (!dtsExport) {
        mismatches.push({
          sourceName: name,
          sourceType: sourceChecker.typeToString(
            sourceChecker.getTypeOfSymbolAtLocation(sourceExport, sourceFile),
          ),
          dtsType: '<missing>',
        })
        continue
      }

      const sourceType = sourceChecker.typeToString(
        sourceChecker.getTypeOfSymbolAtLocation(sourceExport, sourceFile),
      )
      const dtsType = dtsChecker.typeToString(
        dtsChecker.getTypeOfSymbolAtLocation(dtsExport, dtsFile),
      )

      // Simple string comparison - could be made more sophisticated
      if (sourceType !== dtsType && !areTypesCompatible(sourceType, dtsType)) {
        mismatches.push({
          sourceName: name,
          sourceType,
          dtsType,
        })
      }
    }
  }

  return {
    valid: mismatches.length === 0,
    mismatches,
  }
}

/**
 * Simple type compatibility check
 */
function areTypesCompatible(sourceType: string, dtsType: string): boolean {
  // Normalize types for comparison
  const normalizeType = (t: string) =>
    t
      .replace(/\s+/g, ' ')
      .replace(/\s*([<>,{}()[\]:;])\s*/g, '$1')
      .trim()

  const normalizedSource = normalizeType(sourceType)
  const normalizedDts = normalizeType(dtsType)

  if (normalizedSource === normalizedDts)
    return true

  // Allow 'any' in dts to match anything
  if (normalizedDts === 'any')
    return true

  // Allow Promise<T> to match PromiseLike<T>
  if (
    normalizedSource.startsWith('Promise<')
    && normalizedDts.startsWith('PromiseLike<')
  ) {
    return true
  }

  return false
}
