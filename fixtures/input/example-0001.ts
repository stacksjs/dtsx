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
}

/**
 * Example of interface declaration
 */
export interface User {
  id: number
  name: string
  email: string
}

/**
 * Example of type declaration
 */
export interface ResponseData {
  success: boolean
  data: User[]
}

/**
 * Example of function declaration
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

export default dts
