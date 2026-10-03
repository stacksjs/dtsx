import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const competitorPattern = /(?:from\s+|import\(\s*)['"](?:typescript|oxc(?:-|['"]))/
const importPattern = /(?:from\s+|import\(\s*)['"](\.[^'"]+)['"]/g

function resolveModule(fromFile: string, specifier: string): string | null {
  const path = resolve(dirname(fromFile), specifier)
  for (const candidate of [`${path}.ts`, resolve(path, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function collectRuntimeGraph(entrypoints: string[]): Map<string, string> {
  const modules = new Map<string, string>()
  const pending = [...entrypoints]
  while (pending.length) {
    const file = pending.pop()!
    if (modules.has(file)) continue
    const source = readFileSync(file, 'utf8')
    modules.set(file, source)
    for (const match of source.matchAll(importPattern)) {
      const dependency = resolveModule(file, match[1])
      if (dependency) pending.push(dependency)
    }
  }
  return modules
}

describe('runtime dependency boundary', () => {
  test('published runtime entrypoints do not load benchmark competitors', () => {
    const root = resolve(import.meta.dir, '..')
    const modules = collectRuntimeGraph([
      resolve(root, 'src/index.ts'),
      resolve(root, 'src/generator.ts'),
      resolve(root, '../bun-plugin/src/index.ts'),
    ])

    for (const [file, source] of modules) {
      expect(source, file).not.toMatch(competitorPattern)
    }
  })

  /**
   * TypeScript 7, the native port, exports only `version` and
   * `versionMajorMinor`. A named value import of anything else is a link
   * error, so the whole module fails to load (#3108). The default import in
   * checker.ts links on every version and guards the API before use.
   */
  test('no source module imports named values from typescript', () => {
    const root = resolve(import.meta.dir, '..')
    const namedValueImport = /^\s*import\s+(?!type\b)(?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)\s+from\s+['"]typescript['"]/m
    const files = [...new Bun.Glob('{src,bin}/**/*.ts').scanSync(root)]
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(resolve(root, file), 'utf8')
      expect(source, file).not.toMatch(namedValueImport)
    }
  })

  test('every source module links under the installed typescript', () => {
    // A separate process: importing every module here would leave their
    // globals and caches behind for the rest of the suite.
    const root = resolve(import.meta.dir, '..')
    const script = `
      const files = [...new Bun.Glob('src/**/*.ts').scanSync(${JSON.stringify(root)})]
      const failures = []
      for (const file of files) {
        try { await import(${JSON.stringify(`${root}/`)} + file) }
        catch (error) { failures.push(file + ': ' + String(error).split('\\n')[0]) }
      }
      console.log(JSON.stringify(failures))
    `
    const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: root })
    const output = result.stdout.toString().trim().split('\n').pop() ?? ''
    expect(JSON.parse(output || 'null'), result.stderr.toString()).toEqual([])
  }, 30000)

  test('published packages do not depend on benchmark competitors', () => {
    for (const path of [resolve(import.meta.dir, '../package.json'), resolve(import.meta.dir, '../../bun-plugin/package.json')]) {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as { dependencies?: Record<string, string>, peerDependencies?: Record<string, string> }
      const runtimeDependencies = { ...manifest.dependencies, ...manifest.peerDependencies }
      expect(runtimeDependencies.typescript).toBeUndefined()
      expect(Object.keys(runtimeDependencies).some(name => name.startsWith('oxc'))).toBe(false)
    }
  })
})
