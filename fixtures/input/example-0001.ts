import type { BunPlugin } from 'bun'
import process from 'node:process'
import { generate, deepMerge } from '@stacksjs/dtsx'
import type { DtsGenerationConfig, DtsGenerationOption } from '@stacksjs/dtsx'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

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

// 1. Complex Generic Types
export interface ComplexGeneric<T extends Record<string, unknown>, K extends keyof T> {
  data: T
  key: K
  value: T[K]
  transform: (input: T[K]) => string
  nested: Array<Partial<T>>
}

// 2. Intersection and Union Types
export type ComplexUnionIntersection =
  | (User & { role: 'admin' })
  | (Product & { category: string })
  & {
    metadata: Record<string, unknown>
  }

export default dts
