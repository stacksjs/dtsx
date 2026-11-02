import { readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { normalizeJsonConfig } from './json-config'

export interface EffectiveTsconfig {
  isolatedDeclarations?: boolean
  /** Absolute, relative to the configuration that declared baseUrl. */
  baseUrl?: string
  paths?: Record<string, string[]>
  /** The configuration directory that declared paths when baseUrl is absent. */
  pathsBasePath?: string
}

interface TsconfigFile {
  extends?: string | string[]
  compilerOptions?: {
    isolatedDeclarations?: boolean
    baseUrl?: string
    paths?: Record<string, string[]>
  }
}

function findConfigFile(path: string): string | null {
  const candidates = [path]
  if (!path.endsWith('.json')) candidates.push(`${path}.json`)
  candidates.push(join(path, 'tsconfig.json'))
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    }
    catch {
      // Try the next supported configuration filename.
    }
  }
  return null
}

function resolveExtendedConfig(specifier: string, configPath: string): string | null {
  if (isAbsolute(specifier) || specifier.startsWith('.'))
    return findConfigFile(resolve(dirname(configPath), specifier))

  const require = createRequire(configPath)
  const packageName = specifier.startsWith('@') ? /^@[^/]+\/[^/]+/.exec(specifier)?.[0] : specifier.split('/')[0]
  // TypeScript presets select package.json's tsconfig field, not a JavaScript
  // main/exports entry. Native require search paths locate the package without
  // evaluating its code or depending on whether package.json is exported.
  if (packageName) {
    for (const directory of require.resolve.paths(packageName) ?? []) {
      const manifestPath = findConfigFile(join(directory, packageName, 'package.json'))
      if (!manifestPath) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { tsconfig?: unknown }
      if (specifier === packageName) {
        if (manifest.tsconfig !== undefined) {
          if (typeof manifest.tsconfig !== 'string') throw new Error(`Invalid tsconfig field in ${manifestPath}`)
          const selected = findConfigFile(resolve(dirname(manifestPath), manifest.tsconfig))
          if (!selected) throw new Error(`Cannot resolve tsconfig ${JSON.stringify(manifest.tsconfig)} from ${manifestPath}`)
          return selected
        }
        const conventional = findConfigFile(join(dirname(manifestPath), 'tsconfig.json'))
        if (conventional) return conventional
      }
      break
    }
  }
  for (const candidate of [`${specifier}/tsconfig.json`, specifier]) {
    try {
      const resolved = require.resolve(candidate)
      const path = resolved.endsWith('.json') ? findConfigFile(resolved) : null
      if (path) return path
    }
    catch {
      // Try the package's conventional configuration subpath next.
    }
  }
  return null
}

/** Read the shared generation options across a JSONC tsconfig hierarchy. */
export async function readEffectiveTsconfig(path: string, readOptions: { allowCircular?: boolean } = {}, ancestors: Set<string> = new Set<string>()): Promise<EffectiveTsconfig | undefined> {
  const configPath = findConfigFile(path)
  if (!configPath) return undefined
  if (ancestors.has(configPath)) {
    if (readOptions.allowCircular) return undefined
    throw new Error(`Circular tsconfig extends: ${configPath}`)
  }
  const visited = new Set(ancestors).add(configPath)
  const input = JSON.parse(normalizeJsonConfig(await readFile(configPath, 'utf8'))) as TsconfigFile
  const extended = typeof input.extends === 'string' ? [input.extends] : input.extends ?? []
  if (!Array.isArray(extended) || extended.some(value => typeof value !== 'string'))
    throw new Error(`Invalid tsconfig extends in ${configPath}`)

  let result: EffectiveTsconfig = {}
  for (const specifier of extended) {
    const parent = resolveExtendedConfig(specifier, configPath)
    if (!parent) throw new Error(`Cannot resolve tsconfig extends ${JSON.stringify(specifier)} from ${configPath}`)
    result = { ...result, ...await readEffectiveTsconfig(parent, readOptions, visited) }
  }

  const options = input.compilerOptions ?? {}
  if (options.isolatedDeclarations !== undefined) result.isolatedDeclarations = options.isolatedDeclarations
  if (options.baseUrl !== undefined) {
    if (typeof options.baseUrl !== 'string') throw new Error(`Invalid baseUrl in ${configPath}`)
    result.baseUrl = resolve(dirname(configPath), options.baseUrl)
  }
  if (options.paths !== undefined) {
    if (!options.paths || typeof options.paths !== 'object' || Array.isArray(options.paths))
      throw new Error(`Invalid paths in ${configPath}`)
    for (const [pattern, targets] of Object.entries(options.paths)) {
      if (pattern.split('*').length > 2 || !Array.isArray(targets) || targets.length === 0
        || targets.some(target => typeof target !== 'string' || target.split('*').length > 2))
        throw new Error(`Invalid path mapping ${JSON.stringify(pattern)} in ${configPath}`)
    }
    result.paths = options.paths
    result.pathsBasePath = dirname(configPath)
  }
  return result
}
