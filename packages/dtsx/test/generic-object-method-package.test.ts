import { test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

// #3142: generic parameters belong to the callable type, not the property name.
const cases = [
  { name: 'generic identity', method: 'identity<T>(value: T): T { return value }', expression: 'api.methods.identity(1)', type: 'number', invalidType: 'string' },
  { name: 'async constrained method', method: 'async load<T extends { id: string }>(value: T): Promise<T> { return value }', expression: '(await api.methods.load({ id: "one" })).id', type: 'string', invalidType: 'number' },
  { name: 'multiple parameters and defaults', method: 'merge<T, U = Partial<T>>(a: T, b: U): T & U { return { ...a, ...b } }', expression: 'api.methods.merge({ id: 1 }, { name: "one" }).name', type: 'string', invalidType: 'number' },
  { name: 'callable constraint', method: 'wrap<T extends () => void>(fn: T): T { return fn }', expression: 'api.methods.wrap(() => 1)()', type: 'number', invalidType: 'string' },
  { name: 'quoted generic method', method: '"my-key"<T>(value: T): T { return value }', expression: 'api.methods["my-key"](1)', type: 'number', invalidType: 'string' },
  { name: 'generic return type with commas', method: 'pair<T, U>(a: T, b: U): Map<T, U> { return new Map([[a, b]]) }', expression: 'api.methods.pair(1, "one").get(1)', type: 'string | undefined', invalidType: 'number' },
] as const

for (const fixture of cases) {
  for (const producer of ['core', 'bun-plugin', 'native'] as const) {
    test(`${producer} preserves ${fixture.name} in a strict installed package`, async () => {
      await checkDeclarationPackage(producer, {
        source: `export const methods = { ${fixture.method}, sentinel: true }`,
        positive: `const value: ${fixture.type} = ${fixture.expression}\nconst sentinel: boolean = api.methods.sentinel`,
        negatives: [{ code: 2322, content: `const value: ${fixture.invalidType} = ${fixture.expression}` }],
      })
    })
  }
}
