import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeEngineAvailable } from '../../dtsx/src/native-engine'
import { processSource as processSdkSource, processSourceWithTypeScriptEngine } from '../../dtsx/src/process-source'
import { isAvailable, runTsc } from '../../dtsx/test/helpers/tsc'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const source = `export interface LocalModel { readonly id: number; where(column: string, value: number): LocalModel }
declare function lazyModel<T>(name: string): T
export const plain = lazyModel<LocalModel>('plain')
export const imported = lazyModel<typeof import('./model.js').default>('imported')
export const factory = lazyModel<ReturnType<typeof import('./model.js').factory>>('factory')
export const method = lazyModel<{ run: (value: string) => number }>('method')
export const callable = lazyModel<(value: string) => number>('callable')
`
const model = `const model = { id: 1, where(column: string, value: number) { return { column, value } } }
export function factory() { return model }
export function shadow() { const model = { id: 'local' }; return model }
export function parameter<T>(model: T) { return model }
export function createLocal() { const local = 1; return { local } }
export function partial({ a, b = 1 }: Record<string, unknown> = {}) { void a; return b }
export function binding({ model }: { model: number }) { return model }
export default model
`
const controls = `import * as api from './api.js'
import * as original from './source.js'
import { shadow, parameter, createLocal, partial, binding } from './model.js'
const shadowId: string = shadow().id
const parameterValue: number = parameter(1)
const localValue: number = createLocal().local
const partialValue: unknown = partial()
const bindingValue: unknown = binding({ model: 1 })
void [shadowId, parameterValue, localValue, partialValue, bindingValue]
const id: number = api.imported.id
const value: number = api.imported.where('id', 1).value
const plainId: number = api.plain.where('id', 1).id
const factoryValue: number = api.factory.where('id', 1).value
const method: number = api.method.run('value')
const callable: number = api.callable('value')
const authored: typeof original.imported = api.imported
const reverse: typeof api.imported = original.imported
type IsAny<T> = 0 extends (1 & T) ? true : false
type NoAny<T extends false> = T
type ModelCheck = NoAny<IsAny<typeof api.imported>>
type FactoryCheck = NoAny<IsAny<typeof api.factory>>
type PartialCheck = NoAny<IsAny<ReturnType<typeof partial>>>
type BindingCheck = NoAny<IsAny<ReturnType<typeof binding>>>
void [id, value, plainId, factoryValue, method, callable, authored, reverse]
`

for (const mode of ['native', 'sdk', 'core'] as const) {
  test(`${mode} generic calls retain import queries and callable type arguments`, async () => {
    expect(ZIG_AVAILABLE).toBe(true)
    if (mode === 'sdk') expect(nativeEngineAvailable()).toBe(true)
    expect(isAvailable).toBe(true)
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-generic-import-'))
    try {
      await writeFile(join(directory, 'source.ts'), source)
      await writeFile(join(directory, 'model.ts'), model)
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { strict: true, skipLibCheck: false, noEmit: true, target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', types: [], paths: {} },
        files: ['consumer.ts'],
      }))
      const declarations = mode === 'native' ? processSource(source) : mode === 'sdk' ? processSdkSource(source, 'api.ts') : processSourceWithTypeScriptEngine(source)
      const modelDeclarations = mode === 'native' ? processSource(model) : mode === 'sdk' ? processSdkSource(model, 'model.ts') : processSourceWithTypeScriptEngine(model)
      for (const [label, content] of [['source', source], [mode, declarations]]) {
        await rm(join(directory, 'api.ts'), { force: true })
        await rm(join(directory, 'api.d.ts'), { force: true })
        await writeFile(join(directory, label === 'source' ? 'api.ts' : 'api.d.ts'), content!)
        if (label !== 'source') {
          await rm(join(directory, 'model.ts'))
          await writeFile(join(directory, 'model.d.ts'), modelDeclarations!)
        }
        await writeFile(join(directory, 'consumer.ts'), controls)
        const valid = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(valid.ok, `${label}: ${valid.output}`).toBe(true)
        for (const invalid of ['const invalid: string = id', "api.imported.where('id', 'wrong')", 'api.method.run(1)', "api.factory.where('id', 'wrong')", 'const invalid: number = shadowId', 'const invalid: { id: number } = binding({ model: 1 })']) {
          await writeFile(join(directory, 'consumer.ts'), `${controls}\n${invalid}`)
          const rejected = runTsc(directory, ['--project', 'tsconfig.json'])
          expect(rejected.ok, label).toBe(false)
          expect(rejected.output.match(/error TS\d+/g), rejected.output).toEqual([invalid.startsWith('const') ? 'error TS2322' : 'error TS2345'])
        }
      }
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
    // Fourteen tsc runs: about 5 s on a CI runner, which is the default limit.
  }, 60_000)
}
