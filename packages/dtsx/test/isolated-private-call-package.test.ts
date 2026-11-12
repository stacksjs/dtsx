import { expect, test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

const source = `
type ModelName = string
function instantiate<T>(name: ModelName): T { void name; return {} as T }
function unusedImplementation(): boolean { return true }
function annotatedImplementation(): number { return 2 }
export const annotated: number = annotatedImplementation()
export const definition = { id: 1, label: 'model' }
export const model = instantiate<typeof import('./index.js').definition>('model')
`
const positive = `
const id: number = api.model.id
const label: string = api.model.label
const annotated: number = api.annotated
type IsAny<T> = 0 extends (1 & T) ? true : false
const safeModel: false = null as unknown as IsAny<typeof api.model>
const safeField: false = null as unknown as IsAny<typeof api.model.id>
void [id, label, annotated, safeModel, safeField]
`

for (const isolatedDeclarations of [false, true]) {
  for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
    test(`${producer} retains private generic callees in ${isolatedDeclarations ? 'isolated' : 'semantic'} packed declarations`, async () => {
      await checkDeclarationPackage(producer, {
        source,
        isolatedDeclarations,
        positive,
        negatives: [
          { code: 2322, content: 'const wrong: string = api.model.id' },
          { code: 2339, content: "api.instantiate('private')" },
        ],
        inspect(declaration) {
          expect(declaration).not.toContain('unusedImplementation')
          expect(declaration).not.toContain('annotatedImplementation')
        },
      })
    })
  }
}
