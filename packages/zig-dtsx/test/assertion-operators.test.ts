import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processSourceWithTypeScriptEngine } from '../../dtsx/src/process-source'
import { isAvailable, runTsc } from '../../dtsx/test/helpers/tsc'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const source = `interface Payload { amount: number; text: string }
export function member(payload: unknown, batchId: string, index: number) {
  return { ...(payload as Record<string, unknown> | undefined ?? {}), _batchId: batchId, _batchIndex: index, _batchTerminalHandler: false }
}
export function terminal(payload: unknown, batchId: string) {
  return { ...(payload as Record<string, unknown> | undefined ?? {}), _batchId: batchId, _batchTerminalHandler: true }
}
export function typed(payload: Payload | undefined) {
  return { ...(payload as Payload | undefined ?? {}), label: 'ok' }
}
export function quoted(payload: unknown) {
  return { ...(payload as Record<'??' | '||' | '&&', number> | undefined ?? {}), label: 'ok' }
}
export function coalesce(value: string | undefined) { return (value as string | undefined) ?? 'fallback' }
export function either(value: string | undefined) { return (value as string | undefined) || 'fallback' }
export function both(value: boolean | undefined) { return (value as boolean | undefined) && { ok: 'yes' } }
export function generic<T extends object>(value: T | undefined, fallback: T) {
  type Maybe = T | undefined
  return (value as Maybe) ?? fallback
}`

const controls = `import * as api from './api.js'
import * as original from './source.js'
declare const text: string | undefined
declare const flag: boolean | undefined
declare const payload: { amount: number; text: string } | undefined
const member = api.member({ _batchId: 1 }, 'batch', 2)
const id: string = member._batchId
const index: number = member._batchIndex
const terminal: boolean = member._batchTerminalHandler
const terminalId: string = api.terminal(null, 'done')._batchId
const amount: number | undefined = api.typed(payload).amount
const typedText: string | undefined = api.typed(payload).text
const operator: number | undefined = api.quoted(null)['??']
const coalesced: string = api.coalesce(text)
const either: string = api.either(text)
const both: false | undefined | { ok: string } = api.both(flag)
const generic: { amount: number; text: string } = api.generic(payload, { amount: 0, text: '' })
const reference = [original.coalesce(text), original.either(text), original.both(flag), original.generic(payload, { amount: 0, text: '' })] as const
const emitted: typeof reference = [api.coalesce(text), api.either(text), api.both(flag), api.generic(payload, { amount: 0, text: '' })]
const reverse: typeof emitted = reference
type IsAny<T> = 0 extends (1 & T) ? true : false
type NoAny<T extends false> = T
type Check = NoAny<IsAny<typeof member>>
void [id, index, terminal, terminalId, amount, typedText, operator, coalesced, either, both, generic, reverse]
`

for (const mode of ['native', 'core'] as const) {
  test(`${mode} assertions respect logical expression and object spread boundaries`, async () => {
    expect(ZIG_AVAILABLE).toBe(true)
    expect(isAvailable).toBe(true)
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-assertion-operators-'))
    try {
      await writeFile(join(directory, 'source.ts'), source)
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true },
        files: ['consumer.ts'],
      }))
      const declarations = mode === 'native' ? processSource(source) : processSourceWithTypeScriptEngine(source)
      // Source controls establish the same contract before generated output is used.
      for (const [label, content] of [['source', source], [mode, declarations]]) {
        await rm(join(directory, 'api.ts'), { force: true })
        await rm(join(directory, 'api.d.ts'), { force: true })
        await writeFile(join(directory, label === 'source' ? 'api.ts' : 'api.d.ts'), content!)
        await writeFile(join(directory, 'consumer.ts'), controls)
        const valid = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(valid.ok, `${label}: ${valid.output}`).toBe(true)
        for (const invalid of ['const invalid: number = id', 'const invalid: string = amount', 'const invalid: number = coalesced']) {
          await writeFile(join(directory, 'consumer.ts'), `${controls}\n${invalid}\nvoid invalid`)
          const rejected = runTsc(directory, ['--project', 'tsconfig.json'])
          expect(rejected.ok, label).toBe(false)
          expect(rejected.output.match(/error TS\d+/g), rejected.output).toEqual(['error TS2322'])
        }
      }
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

// The conditional types for logical operators are already decided when the
// left operand is `unknown`, so both engines print the decided type.
const testIfNative = ZIG_AVAILABLE ? test : test.skip
testIfNative.each([
  ['??', `some.object ?? 'default'`, '{} | string'],
  ['||', `some.object || 'default'`, '{} | string'],
  ['&&', `some.object && 'default'`, 'unknown'],
  ['?? with an unknown fallback', `some.object ?? other.value`, 'unknown'],
])('an unknown left operand of %s is printed without a conditional type', (_operator, expression, expected) => {
  const input = `export const config = {\n  read: () => {\n    return ${expression}\n  },\n}\nexport function read() { return ${expression} }\n`
  for (const output of [processSource(input, true), processSourceWithTypeScriptEngine(input, 'config.ts')]) {
    expect(output).toContain(`read: () => ${expected}\n`)
    expect(output).toContain(`export declare function read(): ${expected};`)
    expect(output).not.toContain('extends')
  }
})
