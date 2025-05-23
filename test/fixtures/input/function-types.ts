// Various function types and signatures

// Function type aliases
export type SimpleFunction = () => void
export type ParameterizedFunction = (a: string, b: number) => boolean
export type GenericFunction = <T>(value: T) => T
export type AsyncFunction = (id: string) => Promise<unknown>

// Function with optional and default parameters
export function withOptionalParams(
  required: string,
  optional?: number,
  defaultParam = 'default'
): void {
  console.log(required, optional, defaultParam)
}

// Function with rest parameters
export function withRestParams(
  first: string,
  ...rest: number[]
): number {
  return rest.reduce((a, b) => a + b, 0)
}

// Function with destructured parameters
export function withDestructuredParams({
  name,
  age = 0,
  ...props
}: {
  name: string
  age?: number
  [key: string]: any
}): void {
  console.log(name, age, props)
}

// Arrow function variations
export const arrowSimple = () => 'simple'
export const arrowWithParams = (x: number, y: number) => x + y
export const arrowAsync = async (url: string) => {
  const response = await fetch(url)
  return response.json()
}
export const arrowGeneric = <T extends object>(obj: T): T => ({ ...obj })

// Higher order functions
export const createMultiplier = (factor: number) => (value: number) => value * factor
export const pipe = <T>(...fns: Array<(value: T) => T>) => (value: T) =>
  fns.reduce((acc, fn) => fn(acc), value)

// Function with this parameter
export function withThisParam(this: { count: number }, increment: number): number {
  return this.count + increment
}

// Constructor function
export interface ConstructorExample {
  new (name: string): { name: string }
  (name: string): string
}

// Function with type predicate
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

// Function with assertion signature
export function assertDefined<T>(value: T | undefined): asserts value is T {
  if (value === undefined) {
    throw new Error('Value is undefined')
  }
}

// Callback function type
export type CallbackFunction = (error: Error | null, result?: unknown) => void

// Method decorator pattern
export const methodDecorator = (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
  return descriptor
}

// Generator function types
export function* simpleGenerator(): Generator<number, void, unknown> {
  yield 1
  yield 2
  yield 3
}

export const generatorArrow = function* <T>(items: T[]): Generator<T, void, unknown> {
  for (const item of items) {
    yield item
  }
}