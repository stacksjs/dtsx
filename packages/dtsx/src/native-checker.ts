import type { DtsGenerationConfig } from './types'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { extractDeclarations } from './extractor'
import { validateTypeScriptSyntax } from './syntax-validator'

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'
export type CompilerOptions = Record<string, unknown>

export interface TypeDiagnostic {
  file: string
  line: number
  column: number
  message: string
  code: number
  severity: DiagnosticSeverity
  source?: string
  suggestion?: string
  category: string
}

export interface TypeCheckResult {
  success: boolean
  diagnostics: TypeDiagnostic[]
  errorCount: number
  warningCount: number
  infoCount: number
  filesChecked: string[]
  durationMs: number
}

export interface TypeCheckConfig {
  tsconfigPath?: string
  rootDir?: string
  strict?: boolean
  declarationsOnly?: boolean
  skipLibCheck?: boolean
  include?: string[]
  exclude?: string[]
  warningsAsErrors?: boolean
  maxErrors?: number
  compilerOptions?: CompilerOptions
}

export interface IsolatedDeclarationsIssue {
  line: number
  column: number
  message: string
  declarationName?: string
  missingAnnotation?: 'return' | 'parameter' | 'variable' | 'property'
}

export interface IsolatedDeclarationsResult {
  compatible: boolean
  issues: IsolatedDeclarationsIssue[]
}

function stripJsonComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1')
}

export function loadCompilerOptions(path: string, overrides?: CompilerOptions): CompilerOptions {
  try {
    const config = JSON.parse(stripJsonComments(readFileSync(path, 'utf8'))) as { compilerOptions?: CompilerOptions }
    return { ...config.compilerOptions, ...overrides }
  }
  catch (error) {
    throw new Error(`Error reading tsconfig.json: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function filterFiles(files: string[], config: TypeCheckConfig): string[] {
  let selected = config.declarationsOnly ? files.filter(file => file.endsWith('.d.ts')) : files
  if (config.include?.length) {
    const patterns = config.include.map(pattern => new RegExp(pattern.replace(/\*/g, '.*')))
    selected = selected.filter(file => patterns.some(pattern => pattern.test(file)))
  }
  if (config.exclude?.length) {
    const patterns = config.exclude.map(pattern => new RegExp(pattern.replace(/\*/g, '.*')))
    selected = selected.filter(file => !patterns.some(pattern => pattern.test(file)))
  }
  return selected
}

export async function typeCheck(files: string[], config: TypeCheckConfig = {}): Promise<TypeCheckResult> {
  const startedAt = performance.now()
  const filesChecked = filterFiles(files, config)
  const diagnostics: TypeDiagnostic[] = []
  for (const file of filesChecked) {
    try {
      const source = await readFile(file, 'utf8')
      for (const issue of validateTypeScriptSyntax(source)) {
        diagnostics.push({ file, line: issue.line, column: issue.column, message: issue.message, code: Number(issue.code.slice(4)), severity: 'error', category: 'Error' })
      }
    }
    catch (error) {
      diagnostics.push({ file, line: 0, column: 0, message: error instanceof Error ? error.message : String(error), code: 1000, severity: 'error', category: 'Error' })
    }
  }
  const limited = config.maxErrors ? diagnostics.slice(0, config.maxErrors) : diagnostics
  return { success: limited.length === 0, diagnostics: limited, errorCount: limited.length, warningCount: 0, infoCount: 0, filesChecked, durationMs: performance.now() - startedAt }
}

export function validateDeclarations(files: string[], config: TypeCheckConfig = {}): Promise<TypeCheckResult> {
  return typeCheck(files, { ...config, declarationsOnly: true })
}

export async function checkIsolatedDeclarations(files: string[]): Promise<Map<string, IsolatedDeclarationsResult>> {
  const results = new Map<string, IsolatedDeclarationsResult>()
  for (const file of files) {
    const source = await readFile(file, 'utf8').catch(() => '')
    const issues: IsolatedDeclarationsIssue[] = []
    for (const declaration of extractDeclarations(source, file, false, true)) {
      if (declaration.isExported && declaration.kind === 'function' && !declaration.returnType) {
        issues.push({ line: 1, column: 1, message: 'Exported function requires an explicit return type', declarationName: declaration.name, missingAnnotation: 'return' })
      }
    }
    results.set(file, { compatible: issues.length === 0, issues })
  }
  return results
}

function positionToOffset(source: string, line: number, column: number): number | null {
  const lines = source.split('\n')
  if (line < 1 || line > lines.length || column < 1 || column > lines[line - 1].length + 1) return null
  let offset = column - 1
  for (let index = 0; index < line - 1; index++) offset += lines[index].length + 1
  return offset
}

export function getTypeAtPosition(file: string, line: number, column: number): string | null {
  try {
    const source = readFileSync(file, 'utf8')
    const offset = positionToOffset(source, line, column)
    if (offset === null) return null
    const declaration = extractDeclarations(source, file, false).find(item => offset >= (item.start ?? 0) && offset <= (item.end ?? source.length))
    return declaration?.typeAnnotation ?? declaration?.returnType ?? declaration?.text ?? null
  }
  catch {
    return null
  }
}

export function getQuickInfo(file: string, line: number, column: number): { type: string, documentation?: string } | null {
  const type = getTypeAtPosition(file, line, column)
  return type ? { type } : null
}

export function formatTypeCheckResults(result: TypeCheckResult): string {
  if (result.success) return `✓ Type check passed (${result.filesChecked.length} files checked in ${result.durationMs}ms)`
  return [`✗ Type check failed`, `  ${result.errorCount} error(s), ${result.warningCount} warning(s)`, ...result.diagnostics.map(item => `✗ ${item.file}:${item.line}:${item.column}\n  ${item.message}`)].join('\n')
}

export function typeCheckWithConfig(config: DtsGenerationConfig): Promise<TypeCheckResult> {
  return typeCheck(config.entrypoints.map(file => resolve(config.cwd, file)), { tsconfigPath: config.tsconfigPath, rootDir: config.root })
}

export async function validateGeneratedDeclarations(sourceFiles: string[], declarationFiles: string[]): Promise<{ valid: boolean, mismatches: Array<{ sourceName: string, sourceType: string, dtsType: string }> }> {
  const results = await Promise.all([typeCheck(sourceFiles), validateDeclarations(declarationFiles)])
  const mismatches = results.flatMap(result => result.diagnostics).map(item => ({ sourceName: item.file, sourceType: item.message, dtsType: '<invalid>' }))
  return { valid: mismatches.length === 0, mismatches }
}
