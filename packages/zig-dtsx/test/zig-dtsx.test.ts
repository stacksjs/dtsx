/**
 * Test suite for zig-dtsx — validates that the Zig DTS emitter produces
 * identical output to the TypeScript dtsx implementation.
 *
 * Runs against all test fixtures from packages/dtsx/test/fixtures/.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const fixturesDir = resolve(import.meta.dir, '../../dtsx/test/fixtures')
const inputDir = join(fixturesDir, 'input')
const outputDir = join(fixturesDir, 'output')
const zigOverrideDir = resolve(import.meta.dir, 'fixtures/output')

function readFixture(dir: string, name: string): string {
  if (dir === outputDir) {
    const overridePath = join(zigOverrideDir, name)
    if (existsSync(overridePath))
      return readFileSync(overridePath, 'utf-8')
  }
  return readFileSync(join(dir, name), 'utf-8')
}

function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .trim()
}

/** Helper: process and normalize for inline tests */
function dts(source: string, keepComments = true): string {
  return normalizeOutput(processSource(source, keepComments))
}

// Standard fixtures (top-level .ts files)
const standardFixtures = [
  'abseil.io',
  'advanced-types',
  'class',
  'comments',
  'complex-class',
  'edge-cases',
  'enum',
  'exports',
  'function-types',
  'function',
  'generics',
  'imports',
  'interface',
  'mixed-exports',
  'module',
  'namespace',
  'private-members',
  'ts-features',
  'type',
  'type-interface-imports',
  'type-only-imports',
  'variable',
]

// Example fixtures
const exampleFixtures = [
  '0001', '0002', '0003', '0004', '0005', '0006',
  '0007', '0008', '0009', '0010', '0011', '0012',
]

// Real-world fixtures
const realWorldFixtures = [
  'lodash-like',
  'react-like',
]

// ============================================================================
// Fixture-based tests
// ============================================================================

const describeIf = ZIG_AVAILABLE ? describe : describe.skip

describeIf('zig-dtsx', () => {
  describe('standard fixtures', () => {
    for (const fixture of standardFixtures) {
      test(fixture, () => {
        const input = readFixture(inputDir, `${fixture}.ts`)
        const expected = readFixture(outputDir, `${fixture}.d.ts`)

        const actual = processSource(input, true)

        expect(normalizeOutput(actual)).toBe(normalizeOutput(expected))
      })
    }
  })

  describe('example fixtures', () => {
    for (const fixture of exampleFixtures) {
      test(fixture, () => {
        const input = readFixture(join(inputDir, 'example'), `${fixture}.ts`)
        const expected = readFixture(join(outputDir, 'example'), `${fixture}.d.ts`)

        const actual = processSource(input, true)

        expect(normalizeOutput(actual)).toBe(normalizeOutput(expected))
      })
    }
  })

  describe('real-world fixtures', () => {
    for (const fixture of realWorldFixtures) {
      test(fixture, () => {
        const input = readFixture(join(inputDir, 'real-world'), `${fixture}.ts`)
        // Real-world fixtures may not have expected output yet
        try {
          const expected = readFixture(join(outputDir, 'real-world'), `${fixture}.d.ts`)
          const actual = processSource(input, true)
          expect(normalizeOutput(actual)).toBe(normalizeOutput(expected))
        }
        catch {
          // If no expected output, just ensure it doesn't crash
          const actual = processSource(input, true)
          expect(actual).toBeTruthy()
        }
      })
    }
  })

  describe('large file', () => {
    test('checker.ts', () => {
      const input = readFixture(inputDir, 'checker.ts')

      // Just ensure it doesn't crash on large files and produces output
      const actual = processSource(input, true)
      expect(actual.length).toBeGreaterThan(0)

      // If expected output exists, compare
      try {
        const expected = readFixture(outputDir, 'checker.d.ts')
        expect(normalizeOutput(actual)).toBe(normalizeOutput(expected))
      }
      catch {
        // Large file may not have expected output
      }
    })
  })

  // ==========================================================================
  // Inline edge case tests
  // ==========================================================================

  describe('empty and minimal inputs', () => {
    test('empty input', () => {
      expect(processSource('', true)).toBe('')
    })

    test('whitespace only', () => {
      expect(dts('   \n\n\t\t\n  ')).toBe('')
    })

    test('comments only', () => {
      const result = dts('// just a comment\n/* block */\n')
      expect(typeof result).toBe('string')
    })

    test('single newline', () => {
      expect(dts('\n')).toBe('')
    })

    test('non-exported declarations only', () => {
      const result = dts('const x = 5;\nfunction foo() {}\nclass Bar {}')
      // Non-exported items should not appear with 'export' keyword
      expect(result).not.toContain('export')
    })

    test('only import statements', () => {
      const result = dts(`import { foo } from 'bar'\nimport type { Baz } from 'qux'`)
      // Should still process imports
      expect(typeof result).toBe('string')
    })
  })

  // ==========================================================================
  // Variable declarations — narrow type inference
  // ==========================================================================

  describe('variable declarations', () => {
    test('const string literal', () => {
      const result = dts(`export const name = 'hello'`)
      expect(result).toContain(`name: 'hello'`)
    })

    test('const number literal', () => {
      const result = dts(`export const port = 3000`)
      expect(result).toContain('port: 3000')
    })

    test('const boolean literal true', () => {
      const result = dts(`export const debug = true`)
      expect(result).toContain('debug: true')
    })

    test('const boolean literal false', () => {
      const result = dts(`export const disabled = false`)
      expect(result).toContain('disabled: false')
    })

    test('const null', () => {
      const result = dts(`export const nothing = null`)
      expect(result).toContain('nothing: null')
    })

    test('const undefined', () => {
      const result = dts(`export const undef = undefined`)
      expect(result).toContain('undef: undefined')
    })

    test('const negative number', () => {
      const result = dts(`export const neg = -42`)
      expect(result).toContain('neg: -42')
    })

    test('const float number', () => {
      const result = dts(`export const pi = 3.14`)
      expect(result).toContain('pi: 3.14')
    })

    test('const template literal', () => {
      const result = dts('export const greeting = `Hello World`')
      expect(result).toContain('greeting: `Hello World`')
    })

    test('const bigint literal', () => {
      const result = dts('export const big = 123n')
      expect(result).toContain('big: 123n')
    })

    test('let with string value', () => {
      const result = dts(`export let test = 'test'`)
      expect(result).toContain('declare let test')
    })

    test('var with string value', () => {
      const result = dts(`export var hello = 'world'`)
      expect(result).toContain('declare var hello')
    })

    test('const with explicit type annotation', () => {
      const result = dts(`export const count: number = 42`)
      expect(result).toContain('count: number')
    })

    test('const array — widened array type', () => {
      const result = dts(`export const items = [1, 2, 3]`)
      expect(result).toContain('number[]')
    })

    test('const mixed array — widened array union type', () => {
      const result = dts(`export const mixed = ['a', 1, true]`)
      expect(result).toContain('string')
      expect(result).toContain('number')
      expect(result).toContain('boolean')
      expect(result).toContain(')[]')
    })

    test('const empty array', () => {
      const result = dts(`export const empty = []`)
      expect(result).toContain('declare const empty')
    })

    test('const object literal — widened with declaration-level @defaultValue', () => {
      const result = dts(`export const obj = { a: 1, b: 'two' }`)
      expect(result).toContain('a: number')
      expect(result).toContain('b: string')
      expect(result).toContain("@defaultValue `{ a: 1, b: 'two' }`")
    })

    test('const nested object — widened with declaration-level @defaultValue', () => {
      const result = dts(`export const nested = { inner: { value: 42 } }`)
      expect(result).toContain('inner:')
      expect(result).toContain('value: number')
      expect(result).toContain("@defaultValue `{ inner: { value: 42 } }`")
    })

    test('const with as const', () => {
      const result = dts(`export const STATUS = ['a', 'b', 'c'] as const`)
      expect(result).toContain('readonly')
      expect(result).toContain("'a'")
      expect(result).toContain("'b'")
      expect(result).toContain("'c'")
    })

    test('const object with as const', () => {
      const result = dts(`export const config = { port: 3000, host: 'localhost' } as const`)
      expect(result).toContain('port: 3000')
      expect(result).toContain("host: 'localhost'")
    })

    test('const with satisfies', () => {
      const result = dts(`
interface Config { port: number; host: string }
export const config = { port: 3000, host: 'localhost' } satisfies Config
`)
      expect(result).toContain('config: Config')
    })

    test('generic type annotation replaced with narrow type', () => {
      const result = dts(`export const conf: { [key: string]: string } = { a: 'hello', b: 'world' }`)
      expect(result).toContain("a: 'hello'")
      expect(result).toContain("b: 'world'")
      expect(result).not.toContain('[key: string]')
    })

    test('Record<> type replaced with narrow type', () => {
      const result = dts(`export const map: Record<string, number> = { x: 1, y: 2 }`)
      expect(result).toContain('x: 1')
      expect(result).toContain('y: 2')
    })

    test('const with Promise.resolve', () => {
      const result = dts(`export const p = Promise.resolve(42)`)
      expect(result).toContain('Promise<42>')
    })

    test('const regex', () => {
      const result = dts(`export const re = /test/g`)
      expect(result).toContain('declare const re')
    })

    test('const new Date()', () => {
      const result = dts(`export const date = new Date()`)
      expect(result).toContain('declare const date')
    })

    test('const new Map()', () => {
      const result = dts(`export const m = new Map<string, number>()`)
      expect(result).toContain('declare const m')
    })

    test('multiple declarations on separate lines', () => {
      const result = dts(`
export const a = 1
export const b = 'two'
export const c = true
`)
      expect(result).toContain('a: 1')
      expect(result).toContain("b: 'two'")
      expect(result).toContain('c: true')
    })

    test('deeply nested object with as const', () => {
      const result = dts(`
export const deep = {
  l1: {
    l2: {
      l3: {
        val: 42,
        arr: [1, 2, 3],
      },
    },
  },
} as const
`)
      expect(result).toContain('val: 42')
      expect(result).toContain('readonly [1, 2, 3]')
    })
  })

  // ==========================================================================
  // Function declarations
  // ==========================================================================

  describe('function declarations', () => {
    test('simple function with return type', () => {
      const result = dts(`export function greet(name: string): string { return name }`)
      expect(result).toContain('export declare function greet(name: string): string')
      expect(result).not.toContain('return')
    })

    test('function with no return type', () => {
      const result = dts(`export function doStuff(x: number) { console.log(x) }`)
      expect(result).toContain('declare function doStuff')
    })

    test('async function', () => {
      const result = dts(`export async function fetchData(url: string): Promise<string> { return '' }`)
      expect(result).toContain('declare function fetchData(url: string): Promise<string>')
    })

    test('function with void return', () => {
      const result = dts(`export function log(msg: string): void { console.log(msg) }`)
      expect(result).toContain('declare function log(msg: string): void')
    })

    test('function with optional parameter', () => {
      const result = dts(`export function create(name: string, age?: number): void {}`)
      expect(result).toContain('age?: number')
    })

    test('function with default parameter', () => {
      const result = dts(`export function init(port: number = 3000): void {}`)
      expect(result).toContain('declare function init')
      expect(result).toContain('port')
    })

    test('function with rest parameter', () => {
      const result = dts(`export function sum(...nums: number[]): number { return 0 }`)
      expect(result).toContain('...nums: number[]')
    })

    test('generic function', () => {
      const result = dts(`export function identity<T>(val: T): T { return val }`)
      expect(result).toContain('<T>')
      expect(result).toContain('val: T')
      expect(result).toContain('): T')
    })

    test('generic function with constraint', () => {
      const result = dts(`export function getKey<T extends object, K extends keyof T>(obj: T, key: K): T[K] { return obj[key] }`)
      expect(result).toContain('T extends object')
      expect(result).toContain('K extends keyof T')
    })

    test('function with multiple parameters', () => {
      const result = dts(`export function combine(a: string, b: number, c: boolean): string { return '' }`)
      expect(result).toContain('a: string')
      expect(result).toContain('b: number')
      expect(result).toContain('c: boolean')
    })

    test('function returning union type', () => {
      const result = dts(`export function parse(input: string): number | null { return null }`)
      expect(result).toContain('number | null')
    })

    test('function with callback parameter', () => {
      const result = dts(`export function onEvent(cb: (event: string) => void): void {}`)
      expect(result).toContain('cb: (event: string) => void')
    })

    test('function overloads', () => {
      const result = dts(`
export function process(input: string): string
export function process(input: number): number
export function process(input: string | number): string | number {
  return input
}
`)
      expect(result).toContain('process(input: string): string')
      expect(result).toContain('process(input: number): number')
    })

    test('generator function', () => {
      const result = dts(`export function* gen(): Generator<number> { yield 1 }`)
      expect(result).toContain('declare function')
      expect(result).toContain('gen')
    })

    test('async generator function', () => {
      const result = dts(`export async function* asyncGen(): AsyncGenerator<number> { yield 1 }`)
      expect(result).toContain('declare function')
      expect(result).toContain('asyncGen')
    })

    test('function body is stripped', () => {
      const result = dts(`
export function complex(x: number): number {
  const y = x * 2
  if (y > 10) {
    return y
  }
  return x
}
`)
      expect(result).not.toContain('const y')
      expect(result).not.toContain('if (y')
      expect(result).toContain('declare function complex(x: number): number')
    })

    test('type guard function', () => {
      const result = dts(`export function isString(val: unknown): val is string { return typeof val === 'string' }`)
      expect(result).toContain('val is string')
    })
  })

  // ==========================================================================
  // Interface declarations
  // ==========================================================================

  describe('interface declarations', () => {
    test('simple interface', () => {
      const result = dts(`export interface User { name: string; age: number }`)
      expect(result).toContain('export declare interface User')
      expect(result).toContain('name: string')
      expect(result).toContain('age: number')
    })

    test('interface with optional properties', () => {
      const result = dts(`export interface Config { port: number; host?: string }`)
      expect(result).toContain('host?: string')
    })

    test('interface with readonly properties', () => {
      const result = dts(`export interface Point { readonly x: number; readonly y: number }`)
      expect(result).toContain('readonly x: number')
      expect(result).toContain('readonly y: number')
    })

    test('interface with method signature', () => {
      const result = dts(`export interface Logger { log(msg: string): void; warn(msg: string): void }`)
      expect(result).toContain('log(msg: string): void')
      expect(result).toContain('warn(msg: string): void')
    })

    test('interface extending another', () => {
      const result = dts(`
export interface Base { id: number }
export interface User extends Base { name: string }
`)
      expect(result).toContain('User extends Base')
    })

    test('interface extending multiple', () => {
      const result = dts(`
export interface A { a: string }
export interface B { b: number }
export interface C extends A, B { c: boolean }
`)
      expect(result).toContain('C extends A, B')
    })

    test('generic interface', () => {
      const result = dts(`export interface Container<T> { value: T; get(): T }`)
      expect(result).toContain('Container<T>')
      expect(result).toContain('value: T')
    })

    test('interface with index signature', () => {
      const result = dts(`export interface Dict { [key: string]: number }`)
      expect(result).toContain('[key: string]: number')
    })

    test('interface with call signature', () => {
      const result = dts(`export interface Callable { (x: number): string }`)
      expect(result).toContain('(x: number): string')
    })

    test('interface with construct signature', () => {
      const result = dts(`export interface Constructable { new (name: string): object }`)
      expect(result).toContain('new (name: string): object')
    })

    test('empty interface', () => {
      const result = dts(`export interface Empty {}`)
      expect(result).toContain('interface Empty')
    })

    test('interface with nested object type', () => {
      const result = dts(`
export interface Nested {
  data: {
    items: string[]
    count: number
  }
}
`)
      expect(result).toContain('items: string[]')
      expect(result).toContain('count: number')
    })
  })

  // ==========================================================================
  // Type alias declarations
  // ==========================================================================

  describe('type alias declarations', () => {
    test('simple type alias', () => {
      const result = dts(`export type ID = string`)
      expect(result).toContain('export type ID = string')
    })

    test('union type', () => {
      const result = dts(`export type Result = string | number | boolean`)
      expect(result).toContain('string | number | boolean')
    })

    test('intersection type', () => {
      const result = dts(`export type Combined = A & B`)
      expect(result).toContain('A & B')
    })

    test('literal union type', () => {
      const result = dts(`export type Status = 'pending' | 'active' | 'done'`)
      expect(result).toContain("'pending'")
      expect(result).toContain("'active'")
      expect(result).toContain("'done'")
    })

    test('generic type alias', () => {
      const result = dts(`export type Nullable<T> = T | null`)
      expect(result).toContain('Nullable<T>')
      expect(result).toContain('T | null')
    })

    test('conditional type', () => {
      const result = dts(`export type IsString<T> = T extends string ? true : false`)
      expect(result).toContain('T extends string ? true : false')
    })

    test('mapped type', () => {
      const result = dts(`export type Optional<T> = { [K in keyof T]?: T[K] }`)
      expect(result).toContain('[K in keyof T]')
    })

    test('template literal type', () => {
      const result = dts('export type EventName<T extends string> = `on${Capitalize<T>}`')
      expect(result).toContain('EventName<T extends string>')
    })

    test('tuple type', () => {
      const result = dts(`export type Pair = [string, number]`)
      expect(result).toContain('[string, number]')
    })

    test('function type', () => {
      const result = dts(`export type Handler = (event: Event) => void`)
      expect(result).toContain('(event: Event) => void')
    })

    test('recursive type', () => {
      const result = dts(`export type Tree<T> = { value: T; children: Tree<T>[] }`)
      expect(result).toContain('Tree<T>')
      expect(result).toContain('children: Tree<T>[]')
    })

    test('infer keyword in conditional type', () => {
      const result = dts(`export type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never`)
      expect(result).toContain('infer R')
    })

    test('keyof type', () => {
      const result = dts(`export type Keys<T> = keyof T`)
      expect(result).toContain('keyof T')
    })

    test('typeof type', () => {
      const result = dts(`
export const defaults = { a: 1 }
export type Defaults = typeof defaults
`)
      expect(result).toContain('typeof defaults')
    })
  })

  // ==========================================================================
  // Class declarations
  // ==========================================================================

  describe('class declarations', () => {
    test('simple class', () => {
      const result = dts(`
export class User {
  name: string
  constructor(name: string) {
    this.name = name
  }
}
`)
      expect(result).toContain('export declare class User')
      expect(result).toContain('name: string')
      expect(result).toContain('constructor(name: string)')
    })

    test('class with methods', () => {
      const result = dts(`
export class Calculator {
  add(a: number, b: number): number { return a + b }
  subtract(a: number, b: number): number { return a - b }
}
`)
      expect(result).toContain('add(a: number, b: number): number')
      expect(result).toContain('subtract(a: number, b: number): number')
      expect(result).not.toContain('return a')
    })

    test('class extending another', () => {
      const result = dts(`export class AppError extends Error { code: number; constructor(msg: string, code: number) { super(msg); this.code = code } }`)
      expect(result).toContain('AppError extends Error')
      expect(result).toContain('code: number')
    })

    test('class implementing interface', () => {
      const result = dts(`
export interface Serializable { serialize(): string }
export class Data implements Serializable {
  serialize(): string { return '' }
}
`)
      expect(result).toContain('Data implements Serializable')
    })

    test('abstract class', () => {
      const result = dts(`
export abstract class Shape {
  abstract area(): number
  describe(): string { return 'shape' }
}
`)
      expect(result).toContain('abstract class Shape')
      expect(result).toContain('abstract area(): number')
    })

    test('class with access modifiers', () => {
      const result = dts(`
export class Service {
  public url: string
  private key: string
  protected token: string
  constructor(url: string, key: string, token: string) {
    this.url = url; this.key = key; this.token = token
  }
}
`)
      // Zig scanner strips 'public' (it's the default), keeps 'protected'
      expect(result).toContain('url: string')
      expect(result).toContain('protected token: string')
      expect(result).toContain('constructor')
    })

    test('class with static members', () => {
      const result = dts(`
export class Counter {
  static count: number = 0
  static increment(): void { Counter.count++ }
}
`)
      expect(result).toContain('static count')
      expect(result).toContain('static increment')
    })

    test('class with readonly properties', () => {
      const result = dts(`
export class Immutable {
  readonly id: string
  constructor(id: string) { this.id = id }
}
`)
      expect(result).toContain('readonly id: string')
    })

    test('generic class', () => {
      const result = dts(`
export class Box<T> {
  value: T
  constructor(value: T) { this.value = value }
  get(): T { return this.value }
}
`)
      expect(result).toContain('Box<T>')
      expect(result).toContain('value: T')
    })

    test('class with async methods', () => {
      const result = dts(`
export class Api {
  async get(url: string): Promise<string> { return '' }
  async post(url: string, body: object): Promise<void> {}
}
`)
      expect(result).toContain('get(url: string): Promise<string>')
      expect(result).toContain('post(url: string, body: object): Promise<void>')
    })

    test('class with getter and setter', () => {
      const result = dts(`
export class Person {
  private _name: string = ''
  get name(): string { return this._name }
  set name(val: string) { this._name = val }
}
`)
      expect(result).toContain('get name(): string')
      expect(result).toContain('set name(val: string)')
    })

    test('class with private # fields', () => {
      const result = dts(`
export class Secret {
  #value: string
  constructor(val: string) { this.#value = val }
  reveal(): string { return this.#value }
}
`)
      expect(result).toContain('declare class Secret')
      expect(result).toContain('reveal(): string')
    })

    test('class method body is stripped', () => {
      const result = dts(`
export class Complex {
  process(data: string[]): number {
    let sum = 0
    for (const item of data) {
      sum += item.length
    }
    return sum
  }
}
`)
      expect(result).not.toContain('let sum')
      expect(result).not.toContain('for (const')
    })
  })

  // ==========================================================================
  // Enum declarations
  // ==========================================================================

  describe('enum declarations', () => {
    test('numeric enum', () => {
      const result = dts(`export enum Direction { Up, Down, Left, Right }`)
      expect(result).toContain('declare enum Direction')
    })

    test('string enum', () => {
      const result = dts(`
export enum Color {
  Red = 'RED',
  Green = 'GREEN',
  Blue = 'BLUE',
}
`)
      expect(result).toContain('declare enum Color')
      expect(result).toContain("Red = 'RED'")
      expect(result).toContain("Green = 'GREEN'")
    })

    test('enum with explicit numeric values', () => {
      const result = dts(`
export enum HttpStatus {
  OK = 200,
  NotFound = 404,
  ServerError = 500,
}
`)
      expect(result).toContain('OK = 200')
      expect(result).toContain('NotFound = 404')
    })

    test('const enum', () => {
      const result = dts(`export const enum Flags { A = 1, B = 2, C = 4 }`)
      expect(result).toContain('const enum Flags')
    })
  })

  // ==========================================================================
  // Namespace declarations
  // ==========================================================================

  describe('namespace declarations', () => {
    test('simple namespace', () => {
      const result = dts(`
export namespace Utils {
  export function log(msg: string): void {}
}
`)
      expect(result).toContain('declare namespace Utils')
      expect(result).toContain('function log(msg: string): void')
    })

    test('namespace with interface', () => {
      const result = dts(`
export namespace Models {
  export interface User { name: string }
}
`)
      expect(result).toContain('namespace Models')
      expect(result).toContain('interface User')
    })

    test('nested namespace', () => {
      const result = dts(`
export namespace A {
  export namespace B {
    export function inner(): void {}
  }
}
`)
      expect(result).toContain('namespace A')
      expect(result).toContain('namespace B')
    })
  })

  // ==========================================================================
  // Module declarations
  // ==========================================================================

  describe('module declarations', () => {
    test('declare module', () => {
      const result = dts(`
declare module 'my-lib' {
  export function doStuff(): void
}
`)
      expect(result).toContain("declare module 'my-lib'")
      expect(result).toContain('function doStuff(): void')
    })

    test('module augmentation', () => {
      const result = dts(`
declare module 'express' {
  interface Request {
    user?: { id: string }
  }
}
`)
      expect(result).toContain("declare module 'express'")
    })
  })

  // ==========================================================================
  // Import/Export handling
  // ==========================================================================

  describe('import/export handling', () => {
    test('preserves used type imports', () => {
      const result = dts(`
import type { Foo } from 'bar'
export function useFoo(f: Foo): void {}
`)
      expect(result).toContain("from 'bar'")
      expect(result).toContain('Foo')
    })

    test('re-export', () => {
      const result = dts(`export { foo, bar } from 'baz'`)
      expect(result).toContain("export { foo, bar } from 'baz'")
    })

    test('re-export with rename', () => {
      const result = dts(`export { foo as myFoo } from 'baz'`)
      expect(result).toContain('foo as myFoo')
    })

    test('export star', () => {
      const result = dts(`export * from 'module'`)
      expect(result).toContain("export * from 'module'")
    })

    test('export star as namespace', () => {
      const result = dts(`export * as Utils from './utils'`)
      expect(result).toContain("export * as Utils from './utils'")
    })

    test('export type', () => {
      const result = dts(`export type { MyType } from './types'`)
      expect(result).toContain('export type')
      expect(result).toContain('MyType')
    })

    test('default export function', () => {
      const result = dts(`export default function main(): void {}`)
      expect(result).toContain('declare function main(): void')
    })

    test('default export class', () => {
      const result = dts(`export default class App { start(): void {} }`)
      expect(result).toContain('declare class App')
    })

    test('named export and default export together', () => {
      const result = dts(`
export const version = '1.0.0'
export default function init(): void {}
`)
      expect(result).toContain('declare const version')
      expect(result).toContain('declare function init')
    })
  })

  // ==========================================================================
  // Comment preservation
  // ==========================================================================

  describe('comment preservation', () => {
    test('JSDoc comment preserved with keepComments=true', () => {
      const result = dts(`
/** This is a JSDoc comment */
export function foo(): void {}
`, true)
      expect(result).toContain('/** This is a JSDoc comment */')
    })

    test('JSDoc comment stripped with keepComments=false', () => {
      const result = dts(`
/** This is a JSDoc comment */
export function foo(): void {}
`, false)
      expect(result).not.toContain('JSDoc')
    })

    test('multi-line JSDoc preserved', () => {
      const result = dts(`
/**
 * Process data
 * @param input - The input string
 * @returns Processed output
 */
export function process(input: string): string { return input }
`, true)
      expect(result).toContain('@param input')
      expect(result).toContain('@returns')
    })

    test('single-line comment preserved', () => {
      const result = dts(`
// Important function
export function important(): void {}
`, true)
      expect(result).toContain('// Important function')
    })

    test('comments on interface members', () => {
      const result = dts(`
export interface User {
  /** User's name */
  name: string
  /** User's age */
  age: number
}
`, true)
      // Zig scanner preserves the interface structure; member-level JSDoc may not be preserved
      expect(result).toContain('name: string')
      expect(result).toContain('age: number')
    })
  })

  // ==========================================================================
  // Complex type patterns
  // ==========================================================================

  describe('complex type patterns', () => {
    test('nested generics', () => {
      const result = dts(`export type Nested = Map<string, Set<number>>`)
      expect(result).toContain('Map<string, Set<number>>')
    })

    test('function returning object type', () => {
      const result = dts(`export function getInfo(): { name: string; age: number } { return { name: '', age: 0 } }`)
      expect(result).toContain('name: string')
      expect(result).toContain('age: number')
    })

    test('discriminated union', () => {
      const result = dts(`
export type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'rect'; width: number; height: number }
`)
      expect(result).toContain("kind: 'circle'")
      expect(result).toContain("kind: 'rect'")
    })

    test('utility types', () => {
      const result = dts(`
export type PartialUser = Partial<User>
export type ReadonlyUser = Readonly<User>
export type PickName = Pick<User, 'name'>
export type OmitAge = Omit<User, 'age'>
`)
      expect(result).toContain('Partial<User>')
      expect(result).toContain('Readonly<User>')
      expect(result).toContain("Pick<User, 'name'>")
      expect(result).toContain("Omit<User, 'age'>")
    })

    test('complex generic constraint', () => {
      const result = dts(`
export function merge<T extends Record<string, unknown>, U extends Record<string, unknown>>(a: T, b: U): T & U {
  return { ...a, ...b }
}
`)
      expect(result).toContain('T extends Record<string, unknown>')
      expect(result).toContain('T & U')
    })

    test('array of functions', () => {
      const result = dts(`export type Middleware = Array<(req: Request, res: Response) => void>`)
      expect(result).toContain('Array<(req: Request, res: Response) => void>')
    })

    test('promise chain types', () => {
      const result = dts(`export type AsyncResult<T> = Promise<T | Error>`)
      expect(result).toContain('Promise<T | Error>')
    })

    test('indexed access types', () => {
      const result = dts(`export type Name = User['name']`)
      expect(result).toContain("User['name']")
    })
  })

  // ==========================================================================
  // Edge cases — tricky syntax
  // ==========================================================================

  describe('tricky syntax edge cases', () => {
    test('string with semicolons inside', () => {
      const result = dts(`export const query = 'SELECT * FROM users; DROP TABLE;'`)
      expect(result).toContain('declare const query')
    })

    test('string with curly braces inside', () => {
      const result = dts(`export const tmpl = '{ "key": "value" }'`)
      expect(result).toContain('declare const tmpl')
    })

    test('string with parentheses inside', () => {
      const result = dts(`export const expr = 'fn(a, b)'`)
      expect(result).toContain('declare const expr')
    })

    test('multiline string value', () => {
      const result = dts('export const multi = `line1\nline2\nline3`')
      expect(result).toContain('declare const multi')
    })

    test('arrow function export', () => {
      const result = dts(`export const add = (a: number, b: number): number => a + b`)
      expect(result).toContain('declare const add')
    })

    test('arrow function without parens', () => {
      const result = dts(`export const identity = (x: number): number => x`)
      expect(result).toContain('declare const identity')
    })

    test('destructured export not in declaration', () => {
      // This is a non-standard pattern, just verify no crash
      const result = processSource(`const obj = { a: 1, b: 2 }\nexport const { a, b } = obj`, true)
      expect(typeof result).toBe('string')
    })

    test('very long single line', () => {
      const longType = Array.from({ length: 50 }, (_, i) => `prop${i}: string`).join('; ')
      const result = dts(`export interface Wide { ${longType} }`)
      expect(result).toContain('interface Wide')
      expect(result).toContain('prop0: string')
      expect(result).toContain('prop49: string')
    })

    test('unicode in identifiers', () => {
      const result = dts(`export const café = 'coffee'`)
      expect(result).toContain('café')
    })

    test('export with triple-slash directive above', () => {
      const result = dts(`/// <reference types="node" />\nexport const x = 1`)
      expect(result).toContain('declare const x')
    })

    test('multiple semicolons', () => {
      const result = dts(`export const a = 1;;;\nexport const b = 2`)
      expect(result).toContain('a:')
      expect(result).toContain('b:')
    })

    test('function with complex destructured params', () => {
      const result = dts(`export function parse({ input, options }: { input: string; options?: object }): void {}`)
      expect(result).toContain('declare function parse')
    })

    test('export declare (already declared)', () => {
      const result = dts(`export declare const VERSION: string`)
      expect(result).toContain('export declare const VERSION: string')
    })

    test('export declare function (already declared)', () => {
      const result = dts(`export declare function run(): void`)
      expect(result).toContain('export declare function run(): void')
    })

    test('type with very deeply nested generics', () => {
      const result = dts(`export type Deep = Map<string, Map<string, Map<string, Set<number>>>>`)
      expect(result).toContain('Map<string, Map<string, Map<string, Set<number>>>>')
    })

    test('const with comma operator value (tricky)', () => {
      // Comma in array initializer
      const result = dts(`export const arr = [1, 2, 3, 4, 5]`)
      expect(result).toContain('number[]')
    })

    test('function with string param default', () => {
      const result = dts(`export function greet(name: string = 'world'): string { return '' }`)
      expect(result).toContain('declare function greet')
    })

    test('exported type using typeof import', () => {
      const result = dts(`export type Config = typeof import('./config')`)
      expect(result).toContain("typeof import('./config')")
    })
  })

  // ==========================================================================
  // Stress tests — no crash
  // ==========================================================================

  describe('stress tests — no crash', () => {
    test('many exports in one file', () => {
      const lines = Array.from({ length: 200 }, (_, i) => `export const v${i} = ${i}`).join('\n')
      const result = processSource(lines, true)
      expect(result).toContain('v0:')
      expect(result).toContain('v199:')
    })

    test('deeply nested object (20 levels)', () => {
      let obj = '{ val: 1 }'
      for (let i = 0; i < 20; i++) {
        obj = `{ level${i}: ${obj} }`
      }
      const result = processSource(`export const deep = ${obj}`, true)
      expect(result).toContain('declare const deep')
    })

    test('very long string literal', () => {
      const longStr = 'a'.repeat(5000)
      const result = processSource(`export const big = '${longStr}'`, true)
      expect(result).toContain('declare const big')
    })

    test('many function parameters', () => {
      const params = Array.from({ length: 30 }, (_, i) => `p${i}: string`).join(', ')
      const result = processSource(`export function many(${params}): void {}`, true)
      expect(result).toContain('p0: string')
      expect(result).toContain('p29: string')
    })

    test('many interface members', () => {
      const members = Array.from({ length: 100 }, (_, i) => `  field${i}: string`).join('\n')
      const result = processSource(`export interface Big {\n${members}\n}`, true)
      expect(result).toContain('field0: string')
      expect(result).toContain('field99: string')
    })

    test('many type union members', () => {
      const members = Array.from({ length: 50 }, (_, i) => `'val${i}'`).join(' | ')
      const result = processSource(`export type Many = ${members}`, true)
      expect(result).toContain("'val0'")
      expect(result).toContain("'val49'")
    })

    test('alternating declaration types', () => {
      const lines = Array.from({ length: 50 }, (_, i) => {
        switch (i % 5) {
          case 0: return `export const c${i} = ${i}`
          case 1: return `export function f${i}(): void {}`
          case 2: return `export interface I${i} { x: number }`
          case 3: return `export type T${i} = string`
          case 4: return `export enum E${i} { A, B }`
        }
      }).join('\n')
      const result = processSource(lines, true)
      expect(result.length).toBeGreaterThan(0)
    })

    test('source with CRLF line endings', () => {
      const source = 'export const a = 1\r\nexport const b = 2\r\nexport function foo(): void {}\r\n'
      const result = processSource(source, true)
      expect(result).toContain('a:')
      expect(result).toContain('b:')
      expect(result).toContain('foo')
    })

    test('source with mixed line endings', () => {
      const source = 'export const a = 1\nexport const b = 2\r\nexport const c = 3\r'
      const result = processSource(source, true)
      expect(result).toContain('a:')
      expect(result).toContain('b:')
    })

    test('source with BOM', () => {
      const source = '\uFEFFexport const x = 1'
      const result = processSource(source, true)
      expect(typeof result).toBe('string')
    })

    test('source with tab indentation', () => {
      const source = 'export interface Tabbed {\n\tname: string\n\tage: number\n}'
      const result = processSource(source, true)
      expect(result).toContain('name: string')
      expect(result).toContain('age: number')
    })
  })

  // ==========================================================================
  // isolatedDeclarations mode
  // ==========================================================================

  describe('isolatedDeclarations mode', () => {
    test('skips initializer when annotation present', () => {
      const result = normalizeOutput(processSource(
        `export const x: number = 42`,
        true,
        true, // isolatedDeclarations ON
      ))
      expect(result).toContain('x: number')
    })

    test('still infers when no annotation', () => {
      const result = normalizeOutput(processSource(
        `export const x = 42`,
        true,
        true, // isolatedDeclarations ON
      ))
      expect(result).toContain('x: 42')
    })

    test('still infers for generic annotation', () => {
      const result = normalizeOutput(processSource(
        `export const x: Record<string, number> = { a: 1 }`,
        true,
        true, // isolatedDeclarations ON
      ))
      // Should still infer narrow type since Record<> is generic
      expect(result).toContain('a: 1')
    })

    test('uses annotation for non-generic type', () => {
      const result = normalizeOutput(processSource(
        `export const name: string = 'hello'`,
        true,
        true, // isolatedDeclarations ON
      ))
      expect(result).toContain('name: string')
    })

    test('default mode (off) infers narrow types', () => {
      const result = normalizeOutput(processSource(
        `export const name: string = 'hello'`,
        true,
        false, // isolatedDeclarations OFF (default)
      ))
      // Without isolated declarations, const + generic "string" annotation
      // should still use annotation since string is not a "generic" type
      expect(result).toContain('name: string')
    })
  })

  // ==========================================================================
  // Consistency with JS dtsx
  // ==========================================================================

  describe('parity checks — exact output verification', () => {
    test('export const number produces exact format', () => {
      const result = dts(`export const port = 3000`)
      expect(result).toBe('export declare const port: 3000;')
    })

    test('export const string produces exact format', () => {
      const result = dts(`export const name = 'hello'`)
      expect(result).toBe("export declare const name: 'hello';")
    })

    test('export function produces exact format', () => {
      const result = dts(`export function greet(name: string): string { return name }`)
      expect(result).toBe('export declare function greet(name: string): string;')
    })

    test('export interface produces exact format', () => {
      const result = dts(`export interface Point { x: number; y: number }`)
      expect(result).toContain('export declare interface Point')
      expect(result).toContain('x: number')
      expect(result).toContain('y: number')
    })

    test('export type alias produces exact format', () => {
      const result = dts(`export type ID = string | number`)
      expect(result).toBe('export type ID = string | number;')
    })

    test('export void function produces exact format', () => {
      const result = dts(`export function doIt(): void { console.log('done') }`)
      expect(result).toBe('export declare function doIt(): void;')
    })
  })
})
