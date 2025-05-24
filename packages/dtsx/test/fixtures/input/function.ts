import type { BunPlugin } from 'bun'
import process from 'node:process'
import { generate, deepMerge } from '@stacksjs/dtsx'
import type { DtsGenerationOption } from '@stacksjs/dtsx'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

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

/**
 * Example of function declaration
 */
export function getProduct(id: number): Promise<ApiResponse<Product>> {
  return fetch(`${settings.apiUrl}/products/${id}`)
    .then(response => response.json()) as Promise<ApiResponse<Product>>
}

export function authenticate(user: string, password: string): Promise<AuthResponse> {
  return fetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ user, password }),
  }).then(response => response.json()) as Promise<AuthResponse>
}

export function dts(options?: DtsGenerationOption): BunPlugin {
  return {
    name: 'bun-plugin-dtsx',

    async setup(build) {
      const cwd = options?.cwd ?? process.cwd()

      await generate({
        ...options,
        cwd,
      })
    },
  }
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

// Complex Function Overloads
export function processData(data: string): string
export function processData(data: number): number
export function processData(data: boolean): boolean
export function processData<T extends object>(data: T): T
export function processData(data: unknown): unknown {
  return data
}

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

/**
 * Extract complete function signature using regex
 */
export function extractFunctionSignature(declaration: string): FunctionSignature {
  // Remove comments and clean up the declaration
  const cleanDeclaration = removeLeadingComments(declaration).trim()

  const functionPattern = /^\s*(export\s+)?(async\s+)?function\s*(\*)?\s*([^(<\s]+)/
  const functionMatch = cleanDeclaration.match(functionPattern)

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

// Type Inference in Functions
export function createApi<T extends Record<string, (...args: any[]) => any>>(
  endpoints: T
): { [K in keyof T]: ReturnType<T[K]> extends Promise<infer R> ? R : ReturnType<T[K]> } {
  return {} as any
}
