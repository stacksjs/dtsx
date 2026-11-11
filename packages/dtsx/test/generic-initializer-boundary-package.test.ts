import { expect, test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

const cases = [
  { name: 'generic assertion', prefix: 'const storage = new Map<string, unknown>() as Map<string, unknown>' },
  { name: 'nested generic assertion', prefix: 'const storage = new Map<string, Map<string, unknown>>() as Map<string, Map<string, unknown>>' },
  { name: 'generic satisfies constraint', prefix: 'const storage = new Map<string, unknown>() satisfies Map<string, unknown>' },
  { name: 'generic instantiation', prefix: 'function identity<T>(value: T): T { return value }\nconst specialized = identity<number>' },
  { name: 'postfix non-null generic instantiation', prefix: 'function identity<T>(value: T): T { return value }\nconst specialized = identity!<number>' },
  { name: 'generic assertion before a comment', prefix: 'const storage = new Map<string, unknown>() as Map<string, unknown> // implementation only' },
  { name: 'generic assertion containing arrow types', prefix: 'const storage = null as unknown as Map<string, () => Map<string, unknown>>' },
  { name: 'generic assertion containing quoted angles', prefix: "const storage = null as unknown as Map<string, '<' | '>'>" },
  { name: 'multiline comparison control', prefix: 'const storage = 2 >\n 1' },
  { name: 'multiline shift control', prefix: 'const storage = 16 >>\n 2' },
  { name: 'multiline greater-than-or-equal control', prefix: 'const storage = 2 >=\n 1' },
  { name: 'generic call continuation control', prefix: 'function identity<T>(value: T): T { return value }\nconst storage = identity<number>\n(1)' },
  { name: 'comparison with function operand control', prefix: 'const storage = (() => 2).length >\n function () {}.length' },
] as const

for (const fixture of cases) {
  for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
    test(`${producer} preserves exports after ${fixture.name}`, async () => {
      await checkDeclarationPackage(producer, {
        source: `${fixture.prefix}\nexport function getValue(): number { return 1 }\nexport function nextValue(): string { return 'next' }`,
        positive: 'const value: number = api.getValue(); const next: string = api.nextValue()',
        negatives: [{ code: 2322, content: 'const value: string = api.getValue()' }],
        inspect(declaration) {
          expect(declaration).toContain('function getValue()')
          expect(declaration).toContain('function nextValue()')
          expect(declaration).not.toContain('storage')
          expect(declaration).not.toContain('specialized')
        },
      })
    })
  }
}

for (const fixture of [
  { name: 'comparison', source: 'export const result = 2 >\n 1', type: 'boolean' },
  { name: 'less-than comparison', source: 'export const result = 1 <\n 2', type: 'boolean' },
  { name: 'shift', source: 'export const result = 16 >>\n 2', type: 'number' },
  { name: 'left shift', source: 'export const result = 16 <<\n 2', type: 'number' },
  { name: 'unsigned shift', source: 'export const result = 16 >>>\n 2', type: 'number' },
  { name: 'comparison containing shifts', source: 'export const result = (16 >> 2) > (1 << 1)', type: 'boolean' },
  { name: 'shift return', source: 'export function result() { return 16 >> 2 }', type: 'number', call: true },
  { name: 'unsigned shift return', source: 'export function result() { return 16 >>> 2 }', type: 'number', call: true },
  { name: 'greater-than-or-equal', source: 'export const result = 2 >=\n 1', type: 'boolean' },
  { name: 'angle assertion comparison continuation', source: 'const left = 2; const right = 1; export const result = left > <number>\n right', type: 'boolean' },
  { name: 'generic call continuation', source: 'function identity<T>(value: T): T { return value }\nexport const result = identity<number>\n(1)', type: 'number' },
  { name: 'specialized Promise call', source: 'export const result = Promise.resolve(1)', type: 'Promise<number>' },
] as const) {
  for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
    test(`${producer} preserves public ${fixture.name} initializer typing`, async () => {
      const expression = 'call' in fixture ? 'api.result()' : 'api.result'
      const typeQuery = 'call' in fixture ? 'ReturnType<typeof api.result>' : 'typeof api.result'
      await checkDeclarationPackage(producer, {
        source: `${fixture.source}\nexport function getValue(): number { return 1 }`,
        positive: `type IsAny<T> = 0 extends (1 & T) ? true : false; const safe: false = null as unknown as IsAny<${typeQuery}>; const result: ${fixture.type} = ${expression}; const value: number = api.getValue()`,
        negatives: [{ code: 2322, content: `const result: string = ${expression}` }],
      })
    })
  }
}
