import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processSourceWithTypeScriptEngine } from '../../dtsx/src/process-source'
import { isAvailable, runTsc } from '../../dtsx/test/helpers/tsc'
import { processSource, ZIG_AVAILABLE } from '../src/index'

for (const mode of ['native', 'core'] as const) {
  test(`${mode} logical fixture returns preserve authored strict contracts`, async () => {
    expect(ZIG_AVAILABLE).toBe(true)
    expect(isAvailable).toBe(true)
    const fixtures = join(import.meta.dir, '../../dtsx/test/fixtures/input')
    const variable = await readFile(join(fixtures, 'variable.ts'), 'utf8')
    const checker = await readFile(join(fixtures, 'checker.ts'), 'utf8')
    const property = variable.match(/anotherOne: \(\) => \{[\s\S]*?\n  \},/)?.[0]
    const predicate = checker.match(/export function isInstantiatedModule\([^]*?\n\}/)?.[0]
    expect(property).toBeDefined()
    expect(predicate).toBeDefined()
    const source = `declare const some: { object: unknown }
declare enum ModuleInstanceState { Instantiated, ConstEnumOnly }
interface ModuleDeclaration { state: ModuleInstanceState }
declare function getModuleInstanceState(node: ModuleDeclaration): ModuleInstanceState
export const settings = { ${property} }
${predicate}
`
    const controls = `import * as api from './api.js'
import * as original from './source.js'
declare const node: Parameters<typeof original.isInstantiatedModule>[0]
const predicate: boolean = api.isInstantiatedModule(node, true)
const nonNullish: {} = api.settings.anotherOne()
const authoredPredicate: ReturnType<typeof original.isInstantiatedModule> = api.isInstantiatedModule(node, false)
const authoredFallback: ReturnType<typeof original.settings.anotherOne> = api.settings.anotherOne()
const reversePredicate: ReturnType<typeof api.isInstantiatedModule> = original.isInstantiatedModule(node, false)
const reverseFallback: ReturnType<typeof api.settings.anotherOne> = original.settings.anotherOne()
type IsAny<T> = 0 extends (1 & T) ? true : false
type NoAny<T extends false> = T
type PredicateCheck = NoAny<IsAny<typeof predicate>>
type FallbackCheck = NoAny<IsAny<ReturnType<typeof api.settings.anotherOne>>>
void [predicate, nonNullish, authoredPredicate, authoredFallback, reversePredicate, reverseFallback]
`
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-logical-fixture-'))
    try {
      await writeFile(join(directory, 'source.ts'), source)
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { strict: true, skipLibCheck: false, noEmit: true, target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', types: [], paths: {} },
        files: ['consumer.ts'],
      }))
      const emitted = mode === 'native' ? processSource(source) : processSourceWithTypeScriptEngine(source)
      for (const [label, contents] of [['source', source], [mode, emitted]]) {
        await rm(join(directory, 'api.ts'), { force: true })
        await rm(join(directory, 'api.d.ts'), { force: true })
        await writeFile(join(directory, label === 'source' ? 'api.ts' : 'api.d.ts'), contents!)
        await writeFile(join(directory, 'consumer.ts'), controls)
        const valid = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(valid.ok, `${label}: ${valid.output}`).toBe(true)
        for (const invalid of ['const invalid: string = predicate', 'const invalid: null = nonNullish']) {
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
