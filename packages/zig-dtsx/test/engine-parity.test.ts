import { describe, expect, test } from 'bun:test'
import { processSourceWithTypeScriptEngine } from '../../dtsx/src/process-source'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const describeIf = ZIG_AVAILABLE ? describe : describe.skip

/**
 * The native engine is held to the TypeScript engine: `@dtsx/dtsx` emits
 * through native when it loads and falls back to TypeScript otherwise, so both
 * must produce the same declarations. Each case pins the shared output.
 *
 * [name, source, isolated declarations, expected output]
 */
const cases: Array<[string, string, boolean, string]> = [
  ["arrow in object argument", "export const store = defineStore('id', { state: () => ({ count: 0 }) })", false, "export declare const store: ReturnType<typeof defineStore>;"],
  ["line comment between array elements", "export const list = ['a', // note\n  'b']", false, "/** @defaultValue `['a', 'b']` */\nexport declare const list: string[];"],
  ["line comment before object property", "export const config = {\n  // section\n  port: 3000,\n}", false, "/** @defaultValue `{ port: 3000 }` */\nexport declare const config: {\n  /** @defaultValue 3000 */\n  port: number\n};"],
  ["class static as const field", "export class C { static readonly mode = 'fast' as const }", false, "export declare class C {\n  static readonly mode: 'fast';\n}"],
  ["namespace const concatenation", "export namespace N { export const label = 'a' + 'b' }", false, "export declare namespace N {\n  export const label: 'ab';\n}"],
  ["namespace const arithmetic", "export namespace N { export const timeout = 60 * 1000 }", false, "export declare namespace N {\n  export const timeout: number;\n}"],
  ["namespace const call", "export namespace N { export const created = makeThing() }", false, "export declare namespace N {\n  export const created: unknown;\n}"],
  ["satisfies in string", "export const text = 'value satisfies Thing'", false, "export declare const text: 'value satisfies Thing';"],
  ["satisfies with annotation", "export const value: Base = { a: 1 } satisfies Wide", false, "export declare const value: Base;"],
  ["assertion after arrow", "export const handler = ((x: number) => x) as Handler", false, "export declare const handler: Handler;"],
  ["modifier-named parameter", "export function apply(override: boolean, readonly: string): void {}", false, "export declare function apply(override: boolean, readonly: string): void;"],
  ["spread of arrays", "export const a = ['x', 'y'] as const\nexport const b = [1, 2]\nexport const merged = [...a, ...b]", false, "export declare const a: readonly ['x', 'y'];\n/** @defaultValue `[1, 2]` */\nexport declare const b: number[];\n/** @defaultValue `[...a, ...b]` */\nexport declare const merged: ((typeof a)[number] | (typeof b)[number])[];"],
  ["const spread of non-array", "export const fixed = [...(flag ? a : b)] as const\nexport const nested = [...[1, 2], 3] as const", false, "export declare const fixed: readonly [...unknown[]];\nexport declare const nested: readonly [...readonly [1, 2], 3];"],
  ["apostrophe in comment", "export const config = {\n  /** The framework's default, didn't change */\n  port: 3000,\n}", false, "/** @defaultValue `{ port: 3000 }` */\nexport declare const config: {\n  /** The framework's default, didn't change */\n  /** @defaultValue 3000 */\n  port: number\n};"],
  ["property naming binding", "const driver = { name: 'stripe' }\nexport const payments = { driver: driver, hooks: manage.webhook }", false, "/** @defaultValue `{ name: 'stripe' }` */\ndeclare const driver: {\n  /** @defaultValue 'stripe' */\n  name: string\n};\nexport declare const payments: {\n  driver: typeof driver;\n  hooks: typeof manage.webhook\n};\nexport {};"],
  ["body negation", "export function off(value: string) { return !value }", false, "export declare function off(value: string): boolean;"],
  ["body fetch", "export async function load(url: string) { return fetch(url) }", false, "export declare function load(url: string): Promise<Response>;"],
  ["body function expression", "export function make() { return (a: number) => a > 1 }", false, "export declare function make(): (a: number) => boolean;"],
  ["body conditional", "export function pick(flag: boolean) { return flag ? 'a' : 1 }", false, "export declare function pick(flag: boolean): string | number;"],
  ["body comparison", "export function same(a: number, b: number) { return a === b }", false, "export declare function same(a: number, b: number): boolean;"],
  ["body parameter member query", "export function name(user: { first: string }) { return user.first }", false, "export declare function name(user: { first: string }): string;"],
  ["typeof operator in body", "export function local() { const x = 1; return typeof x }", false, "export declare function local(): string;"],
  ["unary operators", "export const kind = typeof value\nexport const nothing = void 0\nexport const removed = delete obj.key\nexport const check = typeof value === 'string'", false, "export declare const kind: string;\nexport declare const nothing: undefined;\nexport declare const removed: boolean;\nexport declare const check: boolean;"],
  ["conditional with literal colon", "export function label(ok: boolean) { return ok ? 'a:b' : 'c?d' }", false, "export declare function label(ok: boolean): string;"],
  ["comments in conditional branches", "export function label(ok: boolean) { return ok ? 'a:b' /* x ? y : z */ : 'c?d' }\nexport function pick(ok: boolean) { return ok ? /* yes */ 1 : /* no */ 2 }", false, "export declare function label(ok: boolean): string;\nexport declare function pick(ok: boolean): number;"],
  ["regex after control header", "export class Q {\n  run(x: string) {\n    if (x) /\\}/.test(x)\n    return 1\n  }\n  after(): void {}\n}", false, "export declare class Q {\n  run(x: string): number;\n  after(): void;\n}"],
  ["commented modifier name", "export class M {\n  private /* note */ () { return 1 }\n}", false, "export declare class M {\n  private(): number;\n}"],
  ["CR-terminated line comment", "export const first = 1 // note\rexport const second = 2", false, "export declare const first: 1;\nexport declare const second: 2;"],
  ["trailing comments after initializers", "export const first = 1 // note\nexport const second = { a: 1 } // trailing\nexport const third = [1, 2] /* x */ // y\nexport const url = 'http://example.com' // site", false, "export declare const first: 1;\n/** @defaultValue `{ a: 1 }` */\nexport declare const second: {\n  /** @defaultValue 1 */\n  a: number\n};\n/** @defaultValue `[1, 2]` */\nexport declare const third: number[];\nexport declare const url: 'http://example.com';"],
  ["element access on global", "export const metadata = $props['metadata'] || {}", false, "export declare const metadata: unknown;"],
  ["isolated method body", "export class Factory { createName() { return 'dtsx' } }", true, "export declare class Factory {\n  createName(): string;\n}"],
  ["isolated getter", "export class Counter { get value() { return 7 } }", true, "export declare class Counter {\n  get value(): unknown;\n}"],
  ["return object without defaults", "export function createRecord() { return { answer: 42 } }", false, "export declare function createRecord(): {\n  answer: number\n};"],
  ["returned callback beside bare return", "export function maybe(flag: boolean) {\n  if (!flag) return\n  return () => flag\n}", false, "export declare function maybe(flag: boolean): (() => unknown) | undefined;"],
  ["async object method", "export function make() {\n  return {\n    async total(amount: number) { return amount * 2 },\n    *ids() { yield 1 },\n  }\n}", true, "export declare function make(): {\n  total: (amount: number) => Promise<number>;\n  ids: () => Generator<unknown, void, unknown>\n};"],
  ["line comment in method parameter type", "export function make() {\n  return {\n    split(options: {\n      id?: string // payee\n      column?: string\n    }) { return 1 },\n  }\n}", false, "export declare function make(): {\n  split: (options: {\n      id?: string\n      column?: string\n    }) => number\n};"],
  ["string concatenation", "export const PREFIX = 'staking' + ':' + 'v1'\nexport const LABEL = 'a: ' + String(1)", false, "export declare const PREFIX: 'staking:v1';\nexport declare const LABEL: string;"],
  ["const assertion with satisfies", "export const floors = { health: '1.0.0' } as const satisfies Partial<Record<string, string>>", false, "export declare const floors: Partial<Record<string, string>>;"],
  ["asserted default export", "declare function hcl(): unknown\nexport default hcl() as (t: number) => string", false, "declare function hcl(): unknown;\ndeclare const __dtsx_default_export__: (t: number) => string;\nexport default __dtsx_default_export__;"],
  ["dotted default export", "const namespace = { value: 1 }\nexport default namespace.value", false, "/** @defaultValue `{ value: 1 }` */\ndeclare const namespace: {\n  /** @defaultValue 1 */\n  value: number\n};\ndeclare const __dtsx_default_export__: typeof namespace.value;\nexport default __dtsx_default_export__;"],
  ["arrow in array", "export const handlers = [() => 'a', 1]", false, "/** @defaultValue `[() => string, 1]` */\nexport declare const handlers: ((() => string) | number)[];"],
  ["member call on parameter", "export const format = (input: Date) => input.toISOString()", false, "export declare const format: (input: Date) => ReturnType<(Date)[\"toISOString\"]>;"],
]

describeIf('native and TypeScript engine parity', () => {
  test.each(cases)('%s', (_name, source, isolated, expected) => {
    const typescript = processSourceWithTypeScriptEngine(source, 'parity.ts', true, ['bun'], isolated).trim()
    const native = processSource(source, true, isolated).trim()
    expect(typescript).toBe(expected)
    expect(native).toBe(expected)
  })

  test('every pinned declaration file parses', () => {
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    for (const [name, , , expected] of cases) {
      expect(() => transpiler.transformSync(expected), name).not.toThrow()
    }
  })
})
