import type { DtsGenerationConfig } from '../src/types'
import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generate } from '../src/generator'
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
