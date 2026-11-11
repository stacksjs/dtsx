import { expect, test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
  for (const isolatedDeclarations of [false, true]) {
    for (const reverse of [false, true]) {
      test(`${producer} retains private type and value declarations sharing a name (reverse=${reverse}, isolated=${isolatedDeclarations})`, async () => {
        const declarations = ['interface Capability { enabled: boolean }', 'const Capability: Capability = { enabled: true }']
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: `${(reverse ? declarations.reverse() : declarations).join('\n')}\nexport function read() { return Capability }`,
          positive: `const enabled: boolean = api.read().enabled;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const safe: false = null as unknown as IsAny<ReturnType<typeof api.read>>;`,
          negatives: [
            { code: 2322, content: 'const wrong: number = api.read().enabled' },
            { code: 2339, content: 'const phantom = api.read().notACapability' },
          ],
        })
      })
    }
    for (const declaration of ['interface Capability { enabled: boolean }', 'type Capability = { enabled: boolean }']) {
      test(`${producer} retains both spaces for a class constant (${declaration.split(' ')[0]}, isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: `${declaration}
const Capability: Capability = { enabled: true }
export class Reader { readonly capability = Capability }`,
          positive: `const value: boolean = new api.Reader().capability.enabled;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const safe: false = null as unknown as IsAny<api.Reader['capability']>;`,
          negatives: [
            { code: 2322, content: 'const wrong: number = new api.Reader().capability.enabled' },
            { code: 2339, content: 'const phantom = new api.Reader().capability.notACapability' },
          ],
        })
      })
    }
    for (const nested of [false, true]) {
      test(`${producer} scopes generic type names independently of private values (nested=${nested}, isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: `interface Capability { hidden: boolean }
const Capability: string = 'private value'
${nested ? 'export interface Reader { identity<Capability>(value: Capability): Capability; }' : 'export function identity<Capability>(value: Capability): Capability { return value }'}`,
          positive: `${nested ? 'declare const reader: api.Reader; const result = reader.identity(42);' : 'const result = api.identity(42);'}
const value: number = result;`,
          negatives: [
            { code: 2322, content: `${nested ? 'declare const reader: api.Reader; const result = reader.identity(42);' : 'const result = api.identity(42);'} const wrong: string = result` },
            { code: 2339, content: `${nested ? 'declare const reader: api.Reader; const result = reader.identity(42);' : 'const result = api.identity(42);'} const phantom = result.hidden` },
          ],
          inspect(declaration) { expect(declaration).not.toContain('interface Capability'); expect(declaration).not.toContain('const Capability') },
        })
      })
    }
    test(`${producer} preserves global type uses outside a method generic scope (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `interface Capability { enabled: boolean }
const Capability: string = 'private value'
export interface Reader { identity<Capability>(value: Capability): Capability; global: Capability; }`,
        positive: `declare const reader: api.Reader; const result: number = reader.identity(42); const enabled: boolean = reader.global.enabled;`,
        negatives: [
          { code: 2322, content: 'declare const reader: api.Reader; const wrong: number = reader.global.enabled' },
          { code: 2339, content: 'declare const reader: api.Reader; const phantom = reader.global.missing' },
        ],
        inspect(declaration) { expect(declaration).toContain('interface Capability'); expect(declaration).not.toContain('const Capability') },
      })
    })
    test(`${producer} retains a free type in a tuple generic default (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `interface Capability { enabled: boolean }
const Capability: string = 'private value'
export function read<T = [number, Capability]>(): T { throw new Error('unimplemented') }`,
        positive: 'const enabled: boolean = api.read()[1].enabled;',
        negatives: [
          { code: 2322, content: 'const wrong: number = api.read()[1].enabled' },
          { code: 2339, content: 'const phantom = api.read()[1].missing' },
        ],
        inspect(declaration) { expect(declaration).toContain('interface Capability'); expect(declaration).not.toContain('const Capability') },
      })
    })
    test(`${producer} ignores a method label sharing a private type name (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `interface Capability { hidden: boolean }
const Capability: string = 'private value'
export interface Reader { Capability(): number }`,
        positive: 'declare const reader: api.Reader; const value: number = reader.Capability();',
        negatives: [
          { code: 2322, content: 'declare const reader: api.Reader; const wrong: string = reader.Capability()' },
          { code: 2339, content: 'declare const reader: api.Reader; const phantom = reader.Capability().hidden' },
        ],
        inspect(declaration) { expect(declaration).not.toContain('interface Capability'); expect(declaration).not.toContain('const Capability') },
      })
    })
    test(`${producer} prunes an unreachable private type alias independently of its value (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `type Capability = { hidden: boolean }
const Capability: string = 'value'
export function read() { return Capability }`,
        positive: 'const value: string = api.read();',
        negatives: [
          { code: 2322, content: 'const wrong: number = api.read()' },
          { code: 2339, content: 'const phantom = api.read().hidden' },
        ],
        inspect(declaration) { expect(declaration).not.toContain('type Capability') },
      })
    })
    for (const clause of ['export type { Capability }', 'export { type Capability }', 'export { Capability }', 'export { type Capability as PublicCapability }', 'export default Capability']) {
      const publicName = clause.includes('default') ? 'default' : clause.includes(' as ') ? 'PublicCapability' : 'Capability'
      const typeOnly = clause.includes('type ')
      test(`${producer} preserves independent spaces through ${clause} (isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: `interface Capability { enabled: boolean }
const Capability: string = 'private value'
${clause}`,
          positive: `declare const value: api.${publicName}; const enabled: boolean = value.enabled; ${typeOnly ? '' : `const exported: string = api.${publicName};`}`,
          negatives: [
            { code: 2322, content: `declare const value: api.${publicName}; const wrong: number = value.enabled` },
            { code: 2339, content: `declare const value: api.${publicName}; const phantom = value.missing` },
          ],
          inspect(declaration) { expect(declaration).toContain('interface Capability'); if (typeOnly) expect(declaration).not.toContain('const Capability') },
        })
      })
    }
    test(`${producer} prunes private names across 1024 generic method scopes (isolated=${isolatedDeclarations})`, async () => {
      const methods = Array.from({ length: 1024 }, (_, index) => `identity${index}<const Capability>(value: Capability): Capability;`).join('\n')
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `interface Capability { hidden: boolean }
const Capability: string = 'private value'
export interface Reader { ${methods} }`,
        positive: 'declare const reader: api.Reader; const first: number = reader.identity0(42); const last: string = reader.identity1023("value");',
        negatives: [
          { code: 2322, content: 'declare const reader: api.Reader; const wrong: string = reader.identity0(42)' },
          { code: 2339, content: 'declare const reader: api.Reader; const phantom = reader.identity1023("value").hidden' },
        ],
        inspect(declaration) { expect(declaration).not.toContain('interface Capability'); expect(declaration).not.toContain('const Capability:') },
      })
    })
    for (const { member, access } of [
      ...['global: Capability', 'readonly global: Capability', "['global']: Capability", 'get global(): Capability'].map(member => ({ member, access: 'reader.global' })),
      ...['0', '12', '1e3', '0xff'].flatMap(name => [
        { member: `${name}: Capability`, access: `reader[${name}]` },
        { member: `readonly ${name}: Capability`, access: `reader[${name}]` },
        { member: `get ${name}(): Capability`, access: `reader[${name}]` },
      ]),
    ]) {
    test(`${producer} ends a generic method scope at a newline member boundary (${member}, isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `interface Capability { enabled: boolean }
const Capability: string = 'private value'
export interface Reader {
 identity<Capability>(value: Capability): Capability
 ${member}
}`,
          positive: `declare const reader: api.Reader; const local: number = reader.identity(42); const enabled: boolean = ${access}.enabled;`,
        negatives: [
            { code: 2322, content: `declare const reader: api.Reader; const wrong: number = ${access}.enabled` },
            { code: 2339, content: `declare const reader: api.Reader; const phantom = ${access}.missing` },
        ],
        inspect(declaration) { expect(declaration).toContain('interface Capability'); expect(declaration).not.toContain('const Capability:') },
      })
    })
    }
    for (const signature of ['(value: number): Capability', '<T>(value: T): Capability']) {
      test(`${producer} ends a generic method scope at an anonymous call signature (${signature}, isolated=${isolatedDeclarations})`, async () => {
        await checkDeclarationPackage(producer, {
          isolatedDeclarations,
          source: `interface Capability { enabled: boolean }
const Capability: string = 'private value'
export interface Reader {
 identity<Capability>(value: Capability): Capability
 ${signature}
}`,
          positive: 'declare const reader: api.Reader; const local: number = reader.identity(42); const enabled: boolean = reader(42).enabled;',
          negatives: [
            { code: 2322, content: 'declare const reader: api.Reader; const wrong: number = reader(42).enabled' },
            { code: 2339, content: 'declare const reader: api.Reader; const phantom = reader(42).missing' },
          ],
          inspect(declaration) { expect(declaration).toContain('interface Capability'); expect(declaration).not.toContain('const Capability:') },
        })
      })
    }
    test(`${producer} retains both binding spaces in a global script (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        global: true,
        isolatedDeclarations,
        source: `type Capability = { enabled: boolean }
const Capability: Capability = { enabled: true }
class Reader { readonly capability = Capability }`,
        positive: `const value: boolean = new Reader().capability.enabled;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const safe: false = null as unknown as IsAny<Reader['capability']>;`,
        negatives: [
          { code: 2322, content: 'const wrong: number = new Reader().capability.enabled' },
          { code: 2339, content: 'const phantom = new Reader().capability.missing' },
        ],
      })
    })
    test(`${producer} ignores an export alias target sharing a private type name (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `interface A { enabled: boolean }
const A: string = 'a'
interface B { hidden: boolean }
const B: string = 'b'
export { type A as B }`,
        positive: 'declare const value: api.B; const enabled: boolean = value.enabled;',
        negatives: [
          { code: 2322, content: 'declare const value: api.B; const wrong: number = value.enabled' },
          { code: 2339, content: 'declare const value: api.B; const phantom = value.hidden' },
        ],
        inspect(declaration) { expect(declaration).not.toContain('interface B'); expect(declaration).not.toContain('const B') },
      })
    })
    test(`${producer} retains only the reachable private type space (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `interface Capability { enabled: boolean }
const Capability: string = 'private value'
export type Result = Capability`,
        positive: `declare const result: api.Result;
const enabled: boolean = result.enabled;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const safe: false = null as unknown as IsAny<api.Result>;`,
        negatives: [
          { code: 2322, content: 'declare const result: api.Result; const wrong: number = result.enabled' },
          { code: 2339, content: 'declare const result: api.Result; const phantom = result.notACapability' },
        ],
        inspect(declaration) { expect(declaration).not.toContain('const Capability') },
      })
    })
    test(`${producer} retains only the reachable private value space (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `interface Capability { hidden: boolean }
const Capability: string = 'value'
export function read() { return Capability }`,
        positive: `const value: string = api.read();
type IsAny<T> = 0 extends (1 & T) ? true : false;
const safe: false = null as unknown as IsAny<ReturnType<typeof api.read>>;`,
        negatives: [
          { code: 2322, content: 'const wrong: number = api.read()' },
          { code: 2339, content: 'const phantom = api.read().hidden' },
        ],
        inspect(declaration) { expect(declaration).not.toContain('interface Capability') },
      })
    })
  }
}
