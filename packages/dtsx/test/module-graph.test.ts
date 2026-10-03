import type { DtsGenerationConfig } from '../src/types'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generator'
import { isAvailable as tscAvailable, runTsc } from './helpers/tsc'
import {
  collectReachableViaReExports,
  resolveRelativeSpecifier,
  scanReExportSpecifiers,
} from '../src/module-graph'

const TMP = join(__dirname, 'temp-module-graph')

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, content)
  }
}

afterEach(async () => {
  try {
    await rm(TMP, { recursive: true, force: true })
  }
  catch {}
})

describe('scanReExportSpecifiers', () => {
  it('finds export * from', () => {
    const refs = scanReExportSpecifiers(`export * from './router';`)
    expect(refs).toEqual([{ specifier: './router', kind: 'export-star', isTypeOnly: false }])
  })

  it('finds export named from', () => {
    const refs = scanReExportSpecifiers(`export { foo, bar } from './baz';`)
    expect(refs).toEqual([{ specifier: './baz', kind: 'export-named', isTypeOnly: false }])
  })

  it('marks type-only re-exports', () => {
    const refs = scanReExportSpecifiers(`export type * from './types';`)
    expect(refs).toEqual([{ specifier: './types', kind: 'export-star', isTypeOnly: true }])
  })

  it('finds export * as ns from', () => {
    const refs = scanReExportSpecifiers(`export * as ns from './ns';`)
    expect(refs[0].kind).toBe('export-star-as')
  })

  it('ignores re-exports inside string literals', () => {
    const src = `const s = "export * from './fake';"`
    expect(scanReExportSpecifiers(src)).toEqual([])
  })

  it('ignores imports inside multiline template literals', () => {
    const src = "const serverCode = `import { Database } from 'bun:sqlite';\nimport { SESClient } from './ts-cloud-dist.js';\n`"
    expect(scanReExportSpecifiers(src, { includeImports: true })).toEqual([])
  })

  it('ignores re-exports inside line comments', () => {
    const src = `// export * from './fake';\nexport * from './real';`
    const refs = scanReExportSpecifiers(src)
    expect(refs).toEqual([{ specifier: './real', kind: 'export-star', isTypeOnly: false }])
  })

  it('ignores re-exports inside block comments', () => {
    const src = `/* export * from './fake'; */\nexport * from './real';`
    const refs = scanReExportSpecifiers(src)
    expect(refs).toEqual([{ specifier: './real', kind: 'export-star', isTypeOnly: false }])
  })

  it('only returns re-exports unless includeImports is true', () => {
    const src = `import { x } from './a';\nexport { y } from './b';`
    expect(scanReExportSpecifiers(src).length).toBe(1)
    expect(scanReExportSpecifiers(src, { includeImports: true }).length).toBe(2)
  })
})

describe('resolveRelativeSpecifier', () => {
  it('returns null for bare specifiers', () => {
    const r = resolveRelativeSpecifier('react', '/x/y/z.ts')
    expect(r.resolved).toBeNull()
    expect(r.isRelative).toBe(false)
  })

  it('resolves a sibling .ts file by extensionless specifier', async () => {
    await writeFiles(TMP, {
      'src/index.ts': `export * from './router';`,
      'src/router.ts': `export const x = 1;`,
    })
    const r = resolveRelativeSpecifier('./router', join(TMP, 'src/index.ts'))
    expect(r.resolved).toBe(join(TMP, 'src/router.ts'))
    expect(r.isRelative).toBe(true)
  })

  it('resolves to an index file when the specifier targets a directory', async () => {
    await writeFiles(TMP, {
      'src/index.ts': `export * from './sub';`,
      'src/sub/index.ts': `export const x = 1;`,
    })
    const r = resolveRelativeSpecifier('./sub', join(TMP, 'src/index.ts'))
    expect(r.resolved).toBe(join(TMP, 'src/sub/index.ts'))
  })

  it('returns null with isRelative=true when the path does not exist', () => {
    const r = resolveRelativeSpecifier('./missing', '/nope/index.ts')
    expect(r.resolved).toBeNull()
    expect(r.isRelative).toBe(true)
  })

  it('maps NodeNext runtime extensions back to TypeScript sources', async () => {
    await writeFiles(TMP, {
      'src/index.ts': '',
      'src/plain.ts': '',
      'src/module.mts': '',
      'src/common.cts': '',
    })
    const from = join(TMP, 'src/index.ts')

    expect(resolveRelativeSpecifier('./plain.js', from).resolved).toBe(join(TMP, 'src/plain.ts'))
    expect(resolveRelativeSpecifier('./module.mjs', from).resolved).toBe(join(TMP, 'src/module.mts'))
    expect(resolveRelativeSpecifier('./common.cjs', from).resolved).toBe(join(TMP, 'src/common.cts'))
  })

  it('resolves relative specifiers with query and fragment suffixes', async () => {
    await writeFiles(TMP, { 'src/index.ts': '', 'src/data.ts': '' })
    const from = join(TMP, 'src/index.ts')

    expect(resolveRelativeSpecifier('./data.js?raw', from).resolved).toBe(join(TMP, 'src/data.ts'))
    expect(resolveRelativeSpecifier('./data#type', from).resolved).toBe(join(TMP, 'src/data.ts'))
  })

  it('resolves authored module declaration extensions', async () => {
    await writeFiles(TMP, { 'src/index.ts': '', 'src/module.d.mts': '', 'src/common.d.cts': '' })
    const from = join(TMP, 'src/index.ts')

    expect(resolveRelativeSpecifier('./module', from).resolved).toBe(join(TMP, 'src/module.d.mts'))
    expect(resolveRelativeSpecifier('./common', from).resolved).toBe(join(TMP, 'src/common.d.cts'))
  })
})

describe('collectReachableViaReExports', () => {
  it('walks transitive re-exports', async () => {
    await writeFiles(TMP, {
      'src/index.ts': `export * from './a';`,
      'src/a.ts': `export * from './b';\nexport const a = 1;`,
      'src/b.ts': `export const b = 2;`,
    })
    const r = await collectReachableViaReExports([join(TMP, 'src/index.ts')])
    expect([...r.reachable].sort()).toEqual([
      join(TMP, 'src/a.ts'),
      join(TMP, 'src/b.ts'),
      join(TMP, 'src/index.ts'),
    ].sort())
    expect(r.unresolved).toEqual([])
  })

  it('reports unresolved relative re-exports', async () => {
    await writeFiles(TMP, {
      'src/index.ts': `export * from './missing';`,
    })
    const r = await collectReachableViaReExports([join(TMP, 'src/index.ts')])
    expect(r.unresolved.length).toBe(1)
    expect(r.unresolved[0].specifier).toBe('./missing')
  })

  it('terminates on cycles', async () => {
    await writeFiles(TMP, {
      'src/a.ts': `export * from './b';`,
      'src/b.ts': `export * from './a';`,
    })
    const r = await collectReachableViaReExports([join(TMP, 'src/a.ts')])
    expect(r.reachable.size).toBe(2)
  })
})

describe('generate auto-includes reachable subpaths', () => {
  it('preserves NodeNext runtime extensions while emitting their TypeScript sources', async () => {
    await writeFiles(TMP, {
      'src/index.mts': `export * from './dependency.mjs';`,
      'src/dependency.mts': `export const dependency: string = 'ready';`,
    })

    await generate({
      cwd: TMP,
      root: 'src',
      entrypoints: ['index.mts'],
      outdir: 'dist',
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
    })

    const declaration = await Bun.file(join(TMP, 'dist/index.d.mts')).text()
    expect(declaration).toContain(`from './dependency.mjs'`)
    expect(await Bun.file(join(TMP, 'dist/dependency.d.mts')).exists()).toBe(true)
  })

  it('preserves runtime extensions when flattening relocated declarations', async () => {
    await writeFiles(TMP, {
      'src/nested/index.ts': `export * from '../dependency.js';`,
      'src/dependency.ts': `export const dependency: string = 'ready';`,
    })

    await generate({
      cwd: TMP,
      root: 'src',
      entrypoints: ['nested/index.ts'],
      outdir: 'dist',
      outputStructure: 'flat',
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
    })

    const declaration = await Bun.file(join(TMP, 'dist/index.d.ts')).text()
    expect(declaration).toContain(`from './dependency.js'`)
  })

  it('preserves authored declaration references without requiring re-emission', async () => {
    await writeFiles(TMP, {
      'src/index.mts': `export type { Ambient } from './ambient.d.mts';`,
      'src/ambient.d.mts': `export interface Ambient { value: string }`,
    })

    await generate({
      cwd: TMP,
      root: 'src',
      entrypoints: ['index.mts'],
      outdir: 'dist',
      autoIncludeReExports: false,
      failOnUnresolvedReExport: true,
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
    })

    const declaration = await Bun.file(join(TMP, 'dist/index.d.mts')).text()
    expect(declaration).toContain(`from './ambient.d.mts'`)
    expect(await Bun.file(join(TMP, 'dist/ambient.d.d.mts')).exists()).toBe(false)
  })
  it('emits .d.ts for siblings reached through re-exports', async () => {
    await writeFiles(TMP, {
      'src/index.ts': `export * from './router';\nexport * from './types';`,
      'src/router.ts': `export class Router {}`,
      'src/types.ts': `export interface RouteConfig { path: string }`,
    })

    const config: DtsGenerationConfig = {
      cwd: TMP,
      root: 'src',
      entrypoints: ['index.ts'],
      outdir: join(TMP, 'dist'),
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
    }

    const stats = await generate(config)
    expect(stats.filesGenerated).toBe(3)

    const router = await Bun.file(join(TMP, 'dist', 'router.d.ts')).text()
    const types = await Bun.file(join(TMP, 'dist', 'types.d.ts')).text()
    expect(router).toContain('Router')
    expect(types).toContain('RouteConfig')
  })

  it('emits .d.ts for siblings reached only through type-position imports', async () => {
    // Regression: a file imported by `import { Foo } from './foo'` and
    // used as a type in a public declaration must also get a `.d.ts`.
    // Otherwise the emitted `.d.ts` keeps the import (because `Foo` is
    // referenced) but the target was never written, and `tsc --noEmit`
    // fails with `Cannot find module './foo'` for every consumer.
    await writeFiles(TMP, {
      'src/index.ts': `export { Template } from './template';`,
      'src/template.ts': `import { Fragment } from './fragment';\nexport class Template {\n  content: Fragment\n  constructor() { this.content = new Fragment() }\n}`,
      'src/fragment.ts': `export class Fragment {\n  nodeType: number = 11\n}`,
    })

    const config: DtsGenerationConfig = {
      cwd: TMP,
      root: 'src',
      entrypoints: ['index.ts'],
      outdir: join(TMP, 'dist'),
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
    }

    const stats = await generate(config)
    expect(stats.filesGenerated).toBe(3)

    const template = await Bun.file(join(TMP, 'dist', 'template.d.ts')).text()
    expect(template).toContain('Template')
    expect(template).toMatch(/import\s*\{\s*Fragment\s*\}\s*from\s*['"]\.\/fragment['"]/)

    // The critical assertion: fragment.d.ts must exist so the import above resolves
    expect(await Bun.file(join(TMP, 'dist', 'fragment.d.ts')).exists()).toBe(true)
    const fragment = await Bun.file(join(TMP, 'dist', 'fragment.d.ts')).text()
    expect(fragment).toContain('Fragment')
  })

  it('respects autoIncludeReExports: false', async () => {
    await writeFiles(TMP, {
      'src/index.ts': `export * from './router';`,
      'src/router.ts': `export class Router {}`,
    })

    const config: DtsGenerationConfig = {
      cwd: TMP,
      root: 'src',
      entrypoints: ['index.ts'],
      outdir: join(TMP, 'dist'),
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
      autoIncludeReExports: false,
    }

    const stats = await generate(config)
    expect(stats.filesGenerated).toBe(1)
    expect(await Bun.file(join(TMP, 'dist', 'router.d.ts')).exists()).toBe(false)
  })

  it('throws with failOnUnresolvedReExport when a sibling is missing', async () => {
    await writeFiles(TMP, {
      'src/index.ts': `export * from './missing';`,
    })

    const config: DtsGenerationConfig = {
      cwd: TMP,
      root: 'src',
      entrypoints: ['index.ts'],
      outdir: join(TMP, 'dist'),
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
      failOnUnresolvedReExport: true,
    }

    await expect(generate(config)).rejects.toThrow(/missing/)
  })
})

describe('generate with bundle: true', () => {
  it('inlines reachable declarations and drops relative re-exports', async () => {
    await writeFiles(TMP, {
      'src/index.ts': `export * from './router';\nexport * from './types';`,
      'src/router.ts': `import type { RouteConfig } from './types';\nexport class Router { register(_: RouteConfig): void {} }`,
      'src/types.ts': `export interface RouteConfig { path: string }`,
    })

    const config: DtsGenerationConfig = {
      cwd: TMP,
      root: 'src',
      entrypoints: ['index.ts'],
      outdir: join(TMP, 'dist'),
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
      bundle: true,
    }

    await generate(config)
    const bundled = await Bun.file(join(TMP, 'dist', 'index.d.ts')).text()

    expect(bundled).toContain('Router')
    expect(bundled).toContain('RouteConfig')
    expect(bundled).not.toContain(`from './router'`)
    expect(bundled).not.toContain(`from './types'`)
  })

  // #3090: dropping every relative re-export only works for `export *`. A
  // renamed, default or namespace re-export named something the bundle never
  // declared, and a non-exported type the inlined declarations used was left
  // out, so consumers saw TS2305/TS2304.
  it('links renamed, default and namespace re-exports into a usable bundle', async () => {
    // Outside the repository: tsc refuses explicit files when it finds a
    // tsconfig.json above the working directory.
    const dir = await mkdtemp(join(tmpdir(), 'dtsx-bundle-link-'))
    await writeFiles(dir, {
      'src/index.ts': [
        `export * from './router'`,
        `export { formatPath as format, type PathOptions as FormatOptions } from './utils'`,
        `export { default as Logger } from './logger'`,
        `export * as helpers from './helpers'`,
        `export { default } from './factory'`,
      ].join('\n'),
      'src/router.ts': [
        `interface RouteTable { [path: string]: number }`,
        `export class Router { table: RouteTable = {} }`,
        `export function makeTable(): RouteTable { return {} }`,
      ].join('\n'),
      'src/utils.ts': [
        `export interface PathOptions { trailingSlash?: boolean }`,
        `export function formatPath(path: string, options: PathOptions = {}): string { return path }`,
      ].join('\n'),
      'src/logger.ts': `export default class Logger { log(message: string): void {} }`,
      // Declares its own `PathOptions`, colliding with utils.ts.
      'src/helpers.ts': [
        `import type { PathOptions as UtilOptions } from './utils'`,
        `export interface PathOptions { base: string }`,
        `export const VERSION: string = '1.0.0'`,
        `export function withSlash(options: UtilOptions): PathOptions { return { base: '/' } }`,
      ].join('\n'),
      'src/factory.ts': [
        `import { Router as R } from './router'`,
        `export default function (): R { return new R() }`,
      ].join('\n'),
      'consumer.ts': [
        `import create, { Router, makeTable, format, helpers, Logger, type FormatOptions } from './dist/index'`,
        `const router: Router = create()`,
        `const size: number = makeTable()['/']`,
        `const options: FormatOptions = { trailingSlash: true }`,
        `const path: string = format('/x', options) + helpers.VERSION`,
        `const base: string = helpers.withSlash(options).base`,
        `const helperOptions: helpers.PathOptions = { base }`,
        `new Logger().log(path)`,
        `export { router, size, helperOptions }`,
      ].join('\n'),
    })

    await generate({
      cwd: dir,
      root: 'src',
      entrypoints: ['index.ts'],
      outdir: join(dir, 'dist'),
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
      bundle: true,
    })
    const bundled = await Bun.file(join(dir, 'dist', 'index.d.ts')).text()

    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(bundled)).not.toThrow()
    expect(bundled).not.toMatch(/from '\.\.?\//)
    expect(bundled).toContain('declare interface RouteTable')
    expect(bundled).toContain('declare interface PathOptions_1 { base: string }')
    expect(bundled).toContain('declare function withSlash(options: PathOptions): PathOptions_1;')
    expect(bundled).toContain('declare function _default(): Router;')
    expect(bundled).toMatch(/declare namespace helpers \{\n {2}export \{ [^}]*PathOptions_1 as PathOptions/)
    const exportClause = bundled.match(/^export \{ (.*) \};$/m)?.[1].split(', ') ?? []
    expect(exportClause.sort()).toEqual(['Logger', 'PathOptions as FormatOptions', 'Router', '_default as default', 'formatPath as format', 'helpers', 'makeTable'].sort())

    if (tscAvailable) {
      const result = runTsc(dir, ['consumer.ts'])
      expect(result.output).toBe('')
      expect(result.ok).toBe(true)
    }
    await rm(dir, { recursive: true, force: true })
  })

  it('writes one bundled file per entrypoint', async () => {
    await writeFiles(TMP, {
      'src/index.ts': `export * from './router';`,
      'src/cli.ts': `export const cli = 1;`,
      'src/router.ts': `export class Router {}`,
    })

    const config: DtsGenerationConfig = {
      cwd: TMP,
      root: 'src',
      entrypoints: ['index.ts', 'cli.ts'],
      outdir: join(TMP, 'dist'),
      clean: false,
      keepComments: false,
      tsconfigPath: '',
      verbose: false,
      bundle: true,
    }

    await generate(config)

    const indexBundle = await Bun.file(join(TMP, 'dist', 'index.d.ts')).text()
    const cliBundle = await Bun.file(join(TMP, 'dist', 'cli.d.ts')).text()

    expect(indexBundle).toContain('Router')
    expect(indexBundle).not.toContain(`from './router'`)
    expect(cliBundle).toContain('cli')
    // cli.ts doesn't pull in Router, so its bundle shouldn't either
    expect(cliBundle).not.toContain('class Router')
  })
})
