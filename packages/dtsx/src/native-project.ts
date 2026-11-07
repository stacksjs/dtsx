import type { DtsGenerationConfig } from './types'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defaultConfig } from './config'
import { createDeclarationReferenceResolver, planDeclarationProject } from './declaration-project'
import { scanReExportSpecifiers } from './module-graph'

/** Versioned data consumed by the native emitter, without a binding dependency. */
export interface NativeSourceEmissionContext {
  version: 1
  moduleSpecifierMode: 'preserve' | 'node'
  sourceFile: string
  outputFile: string
  sourceHash: string
  /** Original imports needed to load project module augmentation providers. */
  augmentationImports?: string[]
  rewrites: Array<{
    specifier: string
    resolvedSource: string
    declarationOutput: string
    emittedSpecifier: string
  }>
}

export interface NativeDeclarationFile {
  readonly sourceFile: string
  readonly outputFile: string
  readonly source: string
  readonly context: NativeSourceEmissionContext
}

export interface NativeDeclarationProject {
  readonly version: 1
  readonly rootPath: string
  readonly outdirPath: string
  readonly files: readonly NativeDeclarationFile[]
}

/**
 * Snapshot actual sources and resolved references for native emission. This
 * plans intended outputs only; it neither emits nor proves package delivery.
 * No TypeScript declaration emitter or native binding runs during planning.
 */
export async function planNativeDeclarationProject(options?: Partial<DtsGenerationConfig>): Promise<NativeDeclarationProject> {
  const config = { ...defaultConfig, ...options }
  const mode = config.moduleSpecifierMode ?? 'preserve'
  if (mode !== 'node' && mode !== 'preserve') throw new Error('moduleSpecifierMode must be preserve or node')
  if (config.plugins?.length) throw new Error('Native project planning does not support generation plugins')
  const plan = await planDeclarationProject(config)
  const files: NativeDeclarationFile[] = []
  for (const sourceFile of plan.files) {
    const bytes = await readFile(sourceFile)
    const source = bytes.toString('utf8')
    if (!Buffer.from(source, 'utf8').equals(bytes)) throw new Error(`Native declaration source must be valid UTF-8: ${sourceFile}`)
    const outputFile = plan.outputBySource.get(sourceFile)!
    const resolveReference = createDeclarationReferenceResolver(sourceFile, config, plan.resolver)
    const rewrites: NativeSourceEmissionContext['rewrites'] = []
    const specifiers = new Set(scanReExportSpecifiers(source, { includeImports: true }).map(reference => reference.specifier))
    for (const specifier of specifiers) {
      const reference = resolveReference(specifier)
      if (reference.kind !== 'local') continue
      const { resolvedSource, declarationOutput, emittedSpecifier } = reference
      rewrites.push({ specifier, resolvedSource, declarationOutput, emittedSpecifier })
    }
    const context: NativeSourceEmissionContext = {
      version: 1, moduleSpecifierMode: mode, sourceFile, outputFile,
      sourceHash: createHash('sha256').update(bytes).digest('hex'), rewrites,
    }
    const augmentationImports = plan.augmentationImports.get(sourceFile)
    if (augmentationImports?.size) context.augmentationImports = [...augmentationImports]
    files.push(Object.freeze({ sourceFile, outputFile, source, context }))
  }
  return Object.freeze({ version: 1, rootPath: resolve(config.cwd, config.root), outdirPath: resolve(config.cwd, config.outdir), files: Object.freeze(files) })
}
