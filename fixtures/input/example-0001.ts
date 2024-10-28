import type { BunPlugin } from 'bun'
import process from 'node:process'
import { generate, deepMerge } from '@stacksjs/dtsx'
import type { DtsGenerationConfig, DtsGenerationOption } from '@stacksjs/dtsx'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Testing some randomness
/**
 * Example of const declaration
 */
export const conf: { [key: string]: string } = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: '5000', // as string
}

export const someObject = {
  someString: 'Stacks',
  someNumber: 1000,
  someBoolean: true,
  someFalse: false,
  someFunction: () => { console.log('hello world') },
  anotherOne: () => {
    // some comment
    /* some other comment */
    return some.object ?? 'default'
  },
  someArray: [1, 2, 3],
  someNestedArray: [
    [1, 2, 3],
    [4, 5, 6, 7, 8, 9, 10],
  ],
  someNestedArray2: [
    [1, 2, 3],
    [4, 5, 6, 7, 8, 9, 10],
    'dummy value',
  ],
  someNestedArray3: [
    [1, 2, 3],
    [4, 5, 6, 7, 8, 9, 10],
    'dummy value',
    [11, 12, 13],
  ],
  someOtherNestedArray: [
    [
      'some text',
      2,
      console.log,
      () => console.log('hello world'),
      helloWorld,
    ],
    [4, 5, 6, 7, 8, 9, 10],
  ],
  someComplexArray: [
    [
      { key: 'value' },
    ],
    [
      { key2: 'value2' },
      'test',
      1000,
    ],
    [
      'some string',
      console.log,
      someFunction(),
    ]
  ],
  someObject: { key: 'value' },
  someNestedObject: {
    key: {
      nestedKey: 'value',
    },
    otherKey: {
      nestedKey: process.cwd(),
      nestedKey2: () => { console.log('hello world') },
    }
  },
  someNestedObjectArray: [
    { key: 'value' },
    { key2: 'value2' },
  ],
  someOtherObject: some.deep.object,
  someInlineCall2: console.log,
  someInlineCall3: console.log(),
}

/**
 * Example of interface declaration
 * with another comment in an extra line
 */
export interface User {
  id: number
  name: string
  email: string
}

/**
 * Example of type declaration
 *
 * with multiple lines of comments, including an empty line
 */
export interface ResponseData {
  success: boolean
  data: User[]
}

/**
 * Example of function declaration
 *
 *
 * with multiple empty lines, including an empty lines
 */
export function fetchUsers(): Promise<ResponseData> {
  return fetch(conf.apiUrl)
    .then(response => response.json()) as Promise<ResponseData>
}

export interface ApiResponse<T> {
  status: number
  message: string
  data: T
}

/**
 * Example of another const declaration
    *
* with multiple empty lines, including being poorly formatted
 */
const settings: { [key: string]: any } = {
  theme: 'dark',
  language: 'en',
}

export interface Product {
  id: number
  name: string
  price: number
}

/**
 * Example of function declaration
 */
export function getProduct(id: number): Promise<ApiResponse<Product>> {
  return fetch(`${settings.apiUrl}/products/${id}`)
    .then(response => response.json()) as Promise<ApiResponse<Product>>
}

export interface AuthResponse {
  token: string
  expiresIn: number
}

export type AuthStatus = 'authenticated' | 'unauthenticated'

export function authenticate(user: string, password: string): Promise<AuthResponse> {
  return fetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user, password }),
  }).then(response => response.json()) as Promise<AuthResponse>
}

export const defaultHeaders = {
  'Content-Type': 'application/json',
}

export function dts(options?: DtsGenerationOption): BunPlugin {
  return {
    name: 'bun-plugin-dtsx',

    async setup(build) {
      const cwd = options?.cwd ?? process.cwd()
      const root = options?.root ?? build.config.root
      const entrypoints = options?.entrypoints ?? build.config.entrypoints
      const outdir = options?.outdir ?? build.config.outdir
      const keepComments = options?.keepComments ?? true
      const clean = options?.clean ?? false
      const tsconfigPath = options?.tsconfigPath ?? './tsconfig.json'

      await generate({
        ...options,
        cwd,
        root,
        entrypoints,
        outdir,
        keepComments,
        clean,
        tsconfigPath,
      })
    },
  }
}

interface Options<T> {
  name: string
  cwd?: string
  defaultConfig: T
}

export async function loadConfig<T extends Record<string, unknown>>({ name, cwd, defaultConfig }: Options<T>): Promise<T> {
  const c = cwd ?? process.cwd()
  const configPath = resolve(c, `${name}.config`)

  if (existsSync(configPath)) {
    try {
      const importedConfig = await import(configPath)
      const loadedConfig = importedConfig.default || importedConfig
      return deepMerge(defaultConfig, loadedConfig)
    }
    catch (error) {
      console.error(`Error loading config from ${configPath}:`, error)
    }
  }

  return defaultConfig
}

// Get loaded config
// eslint-disable-next-line antfu/no-top-level-await
const dtsConfig: DtsGenerationConfig = await loadConfig({
  name: 'dts',
  cwd: process.cwd(),
  defaultConfig: {
    cwd: process.cwd(),
    root: './src',
    entrypoints: ['**/*.ts'],
    outdir: './dist',
    keepComments: true,
    clean: true,
    tsconfigPath: './tsconfig.json',
  },
})

export { generate, dtsConfig }

export type { DtsGenerationOption }

export { config } from './config'
export * from './extract'
export * from './generate'
export * from './types'
export * from './utils'

// Complex Generic Types
export interface ComplexGeneric<T extends Record<string, unknown>, K extends keyof T> {
  data: T
  key: K
  value: T[K]
  transform: (input: T[K]) => string
  nested: Array<Partial<T>>
}

// Intersection and Union Types
export type ComplexUnionIntersection =
  | (User & { role: 'admin' })
  | (Product & { category: string })
  & {
    metadata: Record<string, unknown>
  }

// Mapped and Conditional Types
export type ReadonlyDeep<T> = {
  readonly [P in keyof T]: T[P] extends object ? ReadonlyDeep<T[P]> : T[P]
}

export type ConditionalResponse<T> = T extends Array<infer U>
  ? ApiResponse<U[]>
  : T extends object
    ? ApiResponse<T>
    : ApiResponse<string>

// Complex Function Overloads
export function processData(data: string): string
export function processData(data: number): number
export function processData(data: boolean): boolean
export function processData<T extends object>(data: T): T
export function processData(data: unknown): unknown {
  return data
}

export type EventType = 'click' | 'focus' | 'blur'
export type ElementType = 'button' | 'input' | 'form'
export type EventHandler = `on${Capitalize<EventType>}${Capitalize<ElementType>}`

// Recursive Types
export type RecursiveObject = {
  id: string
  children?: RecursiveObject[]
  parent?: RecursiveObject
  metadata: Record<string, unknown>
}

// Complex Arrays and Tuples
export const complexArrays = {
  matrix: [
    [1, 2, [3, 4, [5, 6]]],
    ['a', 'b', ['c', 'd']],
    [true, [false, [true]]],
  ],
  tuples: [
    [1, 'string', true] as const,
    ['literal', 42, false] as const,
  ],
  // TODO: get this part to generate correctly
  // mixedArrays: [
  //   new Date(),
  //   Promise.resolve('async'),
  //   async () => 'result',
  //   function* generator() { yield 42 },
  // ]
}

// TODO: Nested Object Types with Methods
// export const complexObject = {
//   handlers: {
//     async onSuccess<T>(data: T): Promise<void> {
//       console.log(data)
//     },
//     onError(error: Error & { code?: number }): never {
//       throw error
//     }
//   },
//   utils: {
//     formatters: {
//       date: (input: Date) => input.toISOString(),
//       currency: (amount: number, currency = 'USD') =>
//         new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
//     }
//   }
// }

// Default Type Parameters
export interface DefaultGeneric<
  T = string,
  K extends keyof any = string,
  V extends Record<K, T> = Record<K, T>
> {
  key: K
  value: T
  record: V
}

// TODO: Method Decorators and Metadata
// export const methodDecorator = (
//   target: any,
//   propertyKey: string,
//   descriptor: PropertyDescriptor
// ) => {
//   return {
//     ...descriptor,
//     enumerable: true,
//   }
// }

// Complex Async Patterns -> due to isolatedDeclarations, we can assume the return type here
export async function* complexAsyncGenerator(): any {
  const results = await Promise.all([
    fetchUsers(),
    getProduct(1),
    authenticate('user', 'pass'),
  ])

  for (const result of results) {
    yield result
  }
}

// Type Assertions and Guards
export function isUser(value: unknown): value is User {
  return (
    typeof value === 'object'
    && value !== null
    && 'id' in value
    && 'email' in value
  )
}

// Branded Types
export type UserId = string & { readonly __brand: unique symbol }
export type ProductId = number & {
  readonly __brand: unique symbol
}

// TODO: Complex Error Handling
// export class CustomError extends Error {
//   constructor(
//     message: string,
//     public readonly code: number,
//     public readonly metadata: Record<string, unknown>
//   ) {
//     super(message)
//     this.name = 'CustomError'
//   }
// }

// Module Augmentation
declare module '@stacksjs/some-module' {
  interface DtsGenerationConfig {
    customPlugins?: Array<{
      name: string
      transform: (code: string) => string
    }>
  }
}

// Utility Type Implementations
export type DeepPartial<T> = T extends object ? {
  [P in keyof T]?: DeepPartial<T[P]>
} : T

export type DeepRequired<T> = T extends object ? {
  [P in keyof T]-?: DeepRequired<T[P]>
} : T

// TODO: Complex Constants with Type Inference
// export const CONFIG_MAP = {
//   development: {
//     features: {
//       auth: {
//         providers: ['google', 'github'] as const,
//         settings: { timeout: 5000, retries: 3 }
//       }
//     }
//   },
//   production: {
//     features: {
//       auth: {
//         providers: ['google', 'github', 'microsoft'] as const,
//         settings: { timeout: 3000, retries: 5 }
//       }
//     }
//   }
// } as const

// Polymorphic Types
export type PolymorphicComponent<P = {}> = {
  <C extends React.ElementType>(
    props: { as?: C } & Omit<React.ComponentPropsWithRef<C>, keyof P> & P
  ): React.ReactElement | null
}

// TODO: Type Inference in Functions
// export function createApi<T extends Record<string, (...args: any[]) => any>>(
//   endpoints: T
// ): { [K in keyof T]: ReturnType<T[K]> extends Promise<infer R> ? R : ReturnType<T[K]> } {
//   return {} as any
// }

// Complex Index Types
export type DynamicRecord<K extends PropertyKey> = {
  [P in K]: P extends number
    ? Array<unknown>
    : P extends string
      ? Record<string, unknown>
      : never
}

// Comments variations
/**
 * Regular expression patterns used throughout the module
 */
interface RegexPatterns {
  /** Import type declarations */
  readonly typeImport: RegExp
  /** Regular import declarations */
  readonly regularImport: RegExp
  /** Async function declarations */
  readonly asyncFunction: RegExp
  /** Generic type parameters */
  readonly functionOverload: RegExp
  /** Module declaration pattern */
  readonly moduleDeclaration: RegExp
  /**
   * Module augmentation pattern
   */
  readonly moduleAugmentation: RegExp
}

/**
 * Extract complete function signature using regex
 */
export function extractFunctionSignature(declaration: string): FunctionSignature {
  // Remove comments and clean up the declaration
  const cleanDeclaration = removeLeadingComments(declaration).trim()

  const functionPattern = /^\s*(export\s+)?(async\s+)?function\s*(\*)?\s*([^(<\s]+)/
  const functionMatch = cleanDeclaration.match(functionPattern)

  if (!functionMatch) {
    console.error('Function name could not be extracted from declaration:', declaration)
    return {
      name: '',
      params: '',
      returnType: 'void',
      generics: '',
    }
  }

  const name = functionMatch[4]
  let rest = cleanDeclaration.slice(cleanDeclaration.indexOf(name) + name.length).trim()

  // Extract generics
  let generics = ''
  if (rest.startsWith('<')) {
    const genericsResult = extractBalancedSymbols(rest, '<', '>')
    if (genericsResult) {
      generics = genericsResult.content
      rest = genericsResult.rest.trim()
    }
  }

  // Extract parameters
  let params = ''
  if (rest.startsWith('(')) {
    const paramsResult = extractBalancedSymbols(rest, '(', ')')
    if (paramsResult) {
      params = paramsResult.content.slice(1, -1).trim()
      rest = paramsResult.rest.trim()
    }
  }

  // Extract return type - keep it exactly as specified
  let returnType = 'void'
  if (rest.startsWith(':')) {
    const match = rest.match(/^:\s*([^{]+)/)
    if (match) {
      returnType = match[1].trim()
    }
  }

  return {
    name,
    params,
    returnType: normalizeType(returnType),
    generics,
  }
}

// export interface ImportTrackingState {
//   typeImports: Map<string, Set<string>>
//   valueImports: Map<string, Set<string>>
//   usedTypes: Set<string>
//   usedValues: Set<string>
// }

export default dts
