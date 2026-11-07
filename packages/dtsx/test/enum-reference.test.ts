import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { processSource as nativeSource, ZIG_AVAILABLE } from '../../zig-dtsx/src'
import { decodeStringLiteral, tokenizeDeclarationSyntax } from '../src/module-references'
import { processSourceSemantic } from '../src/process-source'
import { traceSync } from './helpers/phase-trace'

/** Extract source syntax only; TypeScript independently computes member values. */
function enumBodies(source: string): Map<string, { syntax: string, members: string }> {
  const tokens = tokenizeDeclarationSyntax(source)
  const result = new Map<string, { syntax: string, members: string }>()
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].kind !== 'word' || source.slice(tokens[index].start, tokens[index].end) !== 'enum' || source[tokens[index + 2]?.start] !== '{') continue
    const name = source.slice(tokens[index + 1].start, tokens[index + 1].end)
    let depth = 0
    let end = index + 2
    for (; end < tokens.length; end++) {
      const token = tokens[end]
      const text = source.slice(token.start, token.end)
      if (token.kind !== 'punctuation') continue
      if (text === '{') depth++
      if (text === '}' && --depth === 0) break
    }
    expect(end).toBeLessThan(tokens.length)
    const members = tokens.slice(index + 2, end + 1).map(token => token.kind === 'quoted'
      ? JSON.stringify(decodeStringLiteral(source.slice(token.start, token.end)))
      : source.slice(token.start, token.end)).join('').replace(/,\}$/, '}')
    const constant = source.slice(tokens[index - 1]?.start, tokens[index - 1]?.end) === 'const'
    result.set(name, { syntax: `export ${constant ? 'const ' : ''}${source.slice(tokens[index].start, tokens[end].end)}`, members })
    index = end
  }
  return result
}

test('all nineteen checker fixture enums agree with ordinary TypeScript declaration emit', async () => {
  expect(ZIG_AVAILABLE).toBe(true)
  const original = await readFile(join(import.meta.dir, 'fixtures/input/checker.ts'), 'utf8')
  const authored = enumBodies(original)
  expect(authored.size).toBe(19)
  const source = [...authored.values()].map(item => item.syntax).join('\n')
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-checker-enum-reference-'))
  try {
    await writeFile(join(directory, 'index.ts'), source)
    await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}')
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', skipLibCheck: false, paths: {}, types: [], declaration: true, emitDeclarationOnly: true, noEmitOnError: true, outDir: './reference' }, files: ['index.ts'] }))
    const compiler = resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js')
    const args = [process.execPath, compiler, '--project', 'tsconfig.json']
    const result = traceSync('TypeScript enum reference emit', () => Bun.spawnSync(args, { cwd: directory, timeout: 4000 }), { cwd: directory, args, sourceHash: new Bun.CryptoHasher('sha256').update(source).digest('hex') })
    expect(result.exitCode, `${JSON.stringify({ exitCode: result.exitCode, signal: result.signalCode })}\n${result.stdout}\n${result.stderr}`).toBe(0)
    const reference = enumBodies(await readFile(join(directory, 'reference/index.d.ts'), 'utf8'))
    expect(reference.size).toBe(19)
    for (const declaration of [processSourceSemantic(source), nativeSource(source, true)]) {
      const actual = enumBodies(declaration)
      expect([...actual.keys()].sort()).toEqual([...reference.keys()].sort())
      for (const [name, expected] of reference) expect(actual.get(name)?.members, name).toBe(expected.members)
    }
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})
