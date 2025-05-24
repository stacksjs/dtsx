// Test edge cases for type inference

// BigInt literals
export const bigIntLiteral = 123n
export const bigIntExpression = BigInt(456)

// Symbol types
export const symbolUnique = Symbol('unique')
export const symbolFor = Symbol.for('shared')

// Template literals
export const templateSimple = `Hello World`
export const templateWithExpression = `Count: ${42}`
export const templateTagged = String.raw`C:\path\to\file`

// Promise types
export const promiseResolved = Promise.resolve(42)
export const promiseRejected = Promise.reject(new Error('fail'))
export const promiseAll = Promise.all([Promise.resolve(1), Promise.resolve('two')])

// Date and built-in types
export const dateInstance = new Date()
export const mapInstance = new Map<string, number>()
export const setInstance = new Set([1, 2, 3])
export const regexInstance = new RegExp('[a-z]+', 'gi')
export const errorInstance = new Error('test error')

// Complex nested structures
export const deeplyNested = {
  level1: {
    level2: {
      level3: {
        value: 'deep' as const,
        array: [1, [2, [3, [4]]]] as const
      }
    }
  }
} as const

// Mixed type arrays
export const mixedTypeArray = [
  'string',
  123,
  true,
  null,
  undefined,
  { key: 'value' },
  [1, 2, 3],
  () => 'function',
  new Date(),
  Promise.resolve('async')
]

// Function with complex overloads
export function complexOverload(value: string): string
export function complexOverload(value: number): number
export function complexOverload(value: boolean): boolean
export function complexOverload<T extends object>(value: T): T
export function complexOverload(value: any): any {
  return value
}

// Async generator function
export async function* asyncGenerator<T>(items: T[]): AsyncGenerator<T, void, unknown> {
  for (const item of items) {
    yield await Promise.resolve(item)
  }
}

// Class with decorators (as comments for now)
// @sealed
export class DecoratedClass {
  // @readonly
  name: string = 'decorated'

  // @deprecated
  oldMethod() {
    return 'deprecated'
  }
}

// Type with conditional and infer
export type ExtractPromise<T> = T extends Promise<infer U> ? U : never
export type ExtractArray<T> = T extends (infer U)[] ? U : never

// Mapped type with template literal
export type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}

// Discriminated union
export type Result<T, E = Error> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: E }

// Recursive type with constraints
export type DeepReadonly<T> = T extends any[] ? DeepReadonlyArray<T[number]> :
  T extends object ? DeepReadonlyObject<T> :
  T

type DeepReadonlyArray<T> = ReadonlyArray<DeepReadonly<T>>
type DeepReadonlyObject<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>
}