/**
 * Regressions for two silent-failure bugs in the 0.11.x line:
 *
 *  1. A re-export clause long enough to wrap was emitted with `;` between
 *     specifiers instead of `,` — `export {\n  a;\n  b;\n} from './x'`, which
 *     no TypeScript parser accepts. A short clause stayed on one line and was
 *     correct, so the break only appeared once an export list grew.
 *  2. `--validate` counted brackets rather than parsing, so it called that
 *     output well-formed and the broken `.d.ts` shipped.
 */

import { $ } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatDts } from '../src/formatter'
import { validateTypeScriptSyntax } from '../src/syntax-validator'

const TEST_DIR = resolve(import.meta.dir, '../.test-export-clause')
const CLI_PATH = resolve(import.meta.dir, '../bin/cli.ts')

async function runCli(args: string[]): Promise<{ stdout: string, stderr: string, exitCode: number }> {
  try {
    const result = await $`bun ${CLI_PATH} ${args}`.cwd(TEST_DIR).quiet()
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode }
  }
  catch (error: any) {
    return { stdout: error.stdout?.toString() || '', stderr: error.stderr?.toString() || '', exitCode: error.exitCode ?? 1 }
  }
}

async function builtIn(content: string): Promise<string> {
  const { content: out } = await formatDts(content, { usePrettier: false } as any)
  return out
}

/** Names long enough that a single-line clause passes the 100-column wrap threshold. */
const LONG_NAMES = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc', 'dddddddddddddddd', 'eeeeeeeeeeeeeeee', 'ffffffffffffffff']

beforeAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true })

  writeFileSync(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, declaration: true },
  }, null, 2))

  writeFileSync(join(TEST_DIR, 'src', 'x.ts'), `${LONG_NAMES.map((n, i) => `export const ${n}: number = ${i}`).join('\n')}\n`)
  writeFileSync(join(TEST_DIR, 'src', 'index.ts'), `export { ${LONG_NAMES.join(', ')} } from './x'\n`)
})

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('formatter — wrapping a long module clause', () => {
  it('separates wrapped export specifiers with commas, not semicolons', async () => {
    const out = await builtIn(`export { ${LONG_NAMES.join(', ')} } from './x';\n`)

    expect(out).toContain('\n') // it did wrap
    expect(out).not.toMatch(/^\s+\w+;$/m)
    for (const name of LONG_NAMES) expect(out).toContain(`  ${name},`)
    expect(out).toContain(`} from './x';`)
  })

  it('keeps the `type` modifier on a wrapped type-only re-export', async () => {
    const names = LONG_NAMES.map(n => n.toUpperCase())
    const out = await builtIn(`export type { ${names.join(', ')} } from './types';\n`)

    expect(out.split('\n')[0]).toBe('export type {')
    expect(out).toContain(`} from './types';`)
    expect(out).not.toContain(';\n  ')
  })

  it('preserves `as` aliases and `default as` when wrapping', async () => {
    const clause = `export { ${LONG_NAMES[0]} as renamedAaaaaaaaaaaa, default as ${LONG_NAMES[1]}, ${LONG_NAMES[2]}, ${LONG_NAMES[3]} };`
    const out = await builtIn(`${clause}\n`)

    expect(out).toContain(`  ${LONG_NAMES[0]} as renamedAaaaaaaaaaaa,`)
    expect(out).toContain(`  default as ${LONG_NAMES[1]},`)
    // A clause with no `from` still terminates with `};`
    expect(out).toContain('\n};')
  })

  it('carries an import-attributes clause through the wrap intact', async () => {
    const out = await builtIn(`export { ${LONG_NAMES.join(', ')} } from './x' with { type: 'json' };\n`)

    expect(out).toContain(`} from './x' with { type: 'json' };`)
    expect(out).toContain(`  ${LONG_NAMES[0]},`)
  })

  it('leaves a short clause on one line', async () => {
    const out = await builtIn(`export { a, b } from './x';\n`)
    expect(out.trim()).toBe(`export { a, b } from './x';`)
  })

  it('still terminates interface members with semicolons', async () => {
    const out = await builtIn(`export interface Foo { aaaaaaaaaaaaaaaaaaaa: string, bbbbbbbbbbbbbbbbbbbb: number, cccccccccccccccccccc: boolean, dd: string }\n`)
    expect(out).toContain('  aaaaaaaaaaaaaaaaaaaa: string;')
    expect(out).toContain('  dd: string;')
  })

  it('still terminates members of a wrapped object type with semicolons', async () => {
    const out = await builtIn(`export declare const cfg: { aaaaaaaaaaaaaaaaaaaa: string, bbbbbbbbbbbbbbbbbbbb: number, cccccccccccccccccccc: boolean };\n`)
    expect(out).toContain('  bbbbbbbbbbbbbbbbbbbb: number;')
  })
})

describe('validator — parsing module clauses', () => {
  it('reports semicolon-separated export specifiers', () => {
    const issues = validateTypeScriptSyntax(`export {\n  aaa;\n  bbb;\n  ccc;\n} from './x';\n`)
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('DTSX1006')
    expect(issues[0].message).toContain(`Unexpected ';' in export clause`)
    expect(issues[0].line).toBe(2)
  })

  it('reports a specifier that is not a binding', () => {
    const issues = validateTypeScriptSyntax(`export { a b c } from './x';\n`)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain(`Invalid export specifier 'a b c'`)
  })

  it('reports the same break in an import clause', () => {
    const issues = validateTypeScriptSyntax(`import {\n  aaa;\n  bbb;\n} from './x';\n`)
    expect(issues[0].message).toContain(`Unexpected ';' in import clause`)
  })

  it.each([
    ['wrapped export', `export {\n  aaa,\n  bbb,\n} from './x';\n`],
    ['inline export', `export { aaa, bbb } from './x';\n`],
    ['type-only clause', `export type { A, B as C } from './x';\n`],
    ['inline type specifier', `import { type D, default as E } from './y';\n`],
    ['string module-export name', `export { "a-b" as c } from './x';\n`],
    ['unicode identifiers', `export { café, naïve } from './x';\n`],
    ['empty clause', `export {};\n`],
    ['trailing comma', `export { a, b, } from './x';\n`],
    ['interface body', `export interface Foo {\n  a: string;\n  b: number;\n}\n`],
    ['object type body', `export declare const c: {\n  a: string;\n  b: number;\n};\n`],
    ['clause inside a comment', `// export { a; b } from './x'\nexport { ok } from './x';\n`],
    ['clause inside a module block', `declare module 'x' {\n  export { a, b } from './y';\n}\n`],
  ])('accepts %s', (_name, source) => {
    expect(validateTypeScriptSyntax(source)).toEqual([])
  })
})

describe('CLI — emitted declarations', () => {
  it('emits a valid wrapped re-export and passes --validate', async () => {
    const result = await runCli(['generate', '--root', 'src', '--entrypoints', 'index.ts', '--outdir', 'dist-wrap', '--validate'])
    expect(result.exitCode).toBe(0)

    const emitted = readFileSync(join(TEST_DIR, 'dist-wrap', 'index.d.ts'), 'utf-8')
    expect(emitted).not.toMatch(/^\s+\w+;$/m)
    for (const name of LONG_NAMES) expect(emitted).toContain(`  ${name},`)
    expect(validateTypeScriptSyntax(emitted)).toEqual([])
  })
})
