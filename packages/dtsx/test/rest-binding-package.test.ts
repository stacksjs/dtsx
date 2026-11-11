import { expect, test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

for (const producer of ['core', 'bun-plugin', 'native', 'typescript'] as const) {
  for (const isolatedDeclarations of [false, true]) {
    test(`${producer} retains parameter rest bindings (isolated=${isolatedDeclarations})`, async () => {
      await checkDeclarationPackage(producer, {
        isolatedDeclarations,
        source: `interface Options {
  mask?: string
  value: number
  nested: { label: string; enabled: boolean; matcher?: RegExp; divisor?: number }
}
export class Password {
  constructor({ mask, ...opts }: Options) {}
  slashes({ nested: { matcher = /[//]/, ...rest } }: Options): string { return rest.label }
  escaped({ nested: { label = "C:\\\\", ...rest } }: Options): boolean { return rest.enabled }
  regex({ nested: { matcher = /[}]/, ...rest } }: Options): string { return rest.label }
  comment({ nested: { matcher = /* note, } */ /[}]/, ...rest } }: Options): string { return rest.label }
  division({ nested: { divisor = 8 / 2, ...rest } }: Options): string { return rest.label }
  method({ mask: alias = 'x', nested: { label = 'default', ...flags }, ...rest }: Options): number { return rest.value }
}
export function object({ mask: alias = 'x', ...rest }: Options): number { return rest.value }
export function array([head = 'x', ...tail]: [string, ...number[]]): number { return tail.length }
export function nested([head, { label = 'x', ...rest }]: [string, { label?: string; value: number }]): number { return rest.value }
export const arrow = ({ mask, ...rest }: Options): number => rest.value`,
        positive: `type IsAny<T> = 0 extends (1 & T) ? true : false;
const options = { value: 1, nested: { label: 'one', enabled: true } };
const password = new api.Password(options);
const method: number = password.method(options);
const regex: string = password.regex(options);
const slashes: string = password.slashes(options);
const escaped: boolean = password.escaped(options);
const comment: string = password.comment(options);
const division: string = password.division(options);
const object: number = api.object(options);
const array: number = api.array(['one', 2, 3]);
const nested: number = api.nested(['one', { value: 1 }]);
const arrow: number = api.arrow(options);
const safe: false = null as unknown as IsAny<Parameters<typeof api.object>[0]>;`,
        negatives: [
          { code: 2322, content: "new api.Password({ value: 'wrong', nested: { label: 'one', enabled: true } })" },
          { code: 2345, content: "api.array(['one', 'wrong'])" },
        ],
        inspect(declaration) {
          expect(declaration).toContain('...opts')
          expect(declaration).toContain('...tail')
          expect(declaration).toContain('...flags')
          expect(declaration).not.toContain("label = 'default'")
        },
      })
    })
  }
}
