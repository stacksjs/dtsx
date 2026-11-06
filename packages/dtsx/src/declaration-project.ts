/**
 * Shared declaration output layout and resolved-reference decisions.
 * This module does not discover files, own resolver state or publish outputs.
 */
import type { ModuleResolver } from './module-graph'
import type { DtsGenerationConfig } from './types'
import { basename, dirname, extname, relative, resolve } from 'node:path'

export type DeclarationReference =
  | { kind: 'unchanged', reason: 'external' | 'unresolved' | 'preserved-declaration', specifier: string, emittedSpecifier: string }
  | { kind: 'local', specifier: string, resolvedSource: string, declarationOutput: string, emittedSpecifier: string }

/** Get the declaration output path without accessing or changing the filesystem. */
export function getDeclarationOutputPath(inputPath: string, config: DtsGenerationConfig): string {
  const rootPath = resolve(config.cwd, config.root)
  const relativePath = relative(rootPath, inputPath)
  const dtsPath = /\.d\.(?:ts|mts|cts)$/.test(relativePath)
    ? relativePath
    : relativePath.replace(/\.(m?tsx?|cts|jsx?|mjs|cjs|vue|stx)$/, (ext) => {
        if (ext === '.mts' || ext === '.mjs') return '.d.mts'
        if (ext === '.cts' || ext === '.cjs') return '.d.cts'
        return '.d.ts'
      })

  if (config.outputStructure === 'mirror') {
    // Mirror the source structure
    return resolve(config.cwd, config.outdir, dtsPath)
  }
  else {
    // Flat structure - just use the filename
    const filename = basename(dtsPath)
    return resolve(config.cwd, config.outdir, filename)
  }
}

export function getDeclarationSpecifier(fromOutputPath: string, toOutputPath: string, runtimeExtension = ''): string {
  let specifier = relative(dirname(fromOutputPath), toOutputPath).replace(/\\/g, '/')
  specifier = specifier
    .replace(/\.d\.mts$/, '')
    .replace(/\.d\.cts$/, '')
    .replace(/\.d\.ts$/, '')

  if (runtimeExtension) specifier += runtimeExtension

  if (!specifier.startsWith('.')) {
    specifier = `./${specifier}`
  }

  return specifier
}

/**
 * Resolve one reference encountered in declaration output. A supplied delivery
 * set identifies the current project boundary; omitting it retains standalone
 * transform behavior and does not establish package delivery.
 */
export function createDeclarationReferenceResolver(
  filePath: string,
  config: DtsGenerationConfig,
  resolveSpecifier: ModuleResolver,
  delivered?: ReadonlySet<string>,
): (specifier: string) => DeclarationReference {
  const outputPath = getDeclarationOutputPath(filePath, config)

  return (specifier: string): DeclarationReference => {
    const resolved = resolveSpecifier(specifier, filePath)
    if (!resolved.isRelative || !resolved.resolved) {
      return { kind: 'unchanged', reason: resolved.isRelative ? 'unresolved' : 'external', specifier, emittedSpecifier: specifier }
    }

    if (/\.d\.(?:ts|mts|cts)$/.test(resolved.resolved)) {
      if (config.moduleSpecifierMode !== 'node') return { kind: 'unchanged', reason: 'preserved-declaration', specifier, emittedSpecifier: specifier }
      if (delivered && !delivered.has(resolved.resolved))
        throw new Error(`Local declaration ${JSON.stringify(specifier)} from ${filePath} targets an authored declaration not emitted by this package build: ${resolved.resolved}. Declaration-only dependencies must be delivered with the package before this importer can be emitted.`)
    }
    if (resolved.isAlias && delivered && !delivered.has(resolved.resolved))
      throw new Error(`Local alias ${JSON.stringify(specifier)} from ${filePath} targets a declaration excluded from this package build: ${resolved.resolved}`)

    const suffix = resolved.isAlias ? resolved.suffix ?? '' : specifier.match(/[?#].*$/)?.[0] ?? ''
    const pathSpecifier = suffix ? specifier.slice(0, -suffix.length) : specifier
    const writtenExtension = extname(pathSpecifier)
    let runtimeExtension = /^(?:\.js|\.jsx|\.mjs|\.cjs)$/.test(writtenExtension) ? writtenExtension : ''
    if (!runtimeExtension && config.moduleSpecifierMode === 'node') {
      const targetExtension = extname(resolved.resolved)
      runtimeExtension = targetExtension === '.mts' || targetExtension === '.mjs'
        ? '.mjs'
        : targetExtension === '.cts' || targetExtension === '.cjs' ? '.cjs' : '.js'
    }
    const declarationOutput = getDeclarationOutputPath(resolved.resolved, config)
    return {
      kind: 'local',
      specifier,
      resolvedSource: resolved.resolved,
      declarationOutput,
      emittedSpecifier: getDeclarationSpecifier(outputPath, declarationOutput, runtimeExtension) + suffix,
    }
  }
}
