/* eslint-disable regexp/no-super-linear-backtracking */
import type { DtsGenerationConfig, ProcessingState } from './types'
import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import process from 'node:process'
import { config } from './config'
import { isFunctionType } from './is'

export async function writeToFile(filePath: string, content: string): Promise<void> {
  await Bun.write(filePath, content)
}

export async function getAllTypeScriptFiles(directory?: string): Promise<string[]> {
  const dir = directory ?? config.root
  const entries = await readdir(dir, { withFileTypes: true })

  const files = await Promise.all(entries.map((entry) => {
    const res = join(dir, entry.name)
    return entry.isDirectory() ? getAllTypeScriptFiles(res) : res
  }))

  return Array.prototype.concat(...files).filter(file => extname(file) === '.ts')
}

export async function checkIsolatedDeclarations(options?: DtsGenerationConfig): Promise<boolean> {
  try {
    const tsconfigPath = options?.tsconfigPath || join(options?.root ?? process.cwd(), 'tsconfig.json')
    const tsconfig = await import(tsconfigPath)

    return tsconfig.compilerOptions?.isolatedDeclarations === true
  }
  catch (error) {
    // eslint-disable-next-line no-console
    console.log('Error reading tsconfig.json:', error)
    return false
  }
}

export function deepMerge<T extends object>(target: T, ...sources: Array<Partial<T>>): T {
  if (!sources.length)
    return target

  const source = sources.shift()

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key]
        if (isObject(sourceValue) && isObject(target[key])) {
          target[key] = deepMerge(target[key] as any, sourceValue as any)
        }
        else {
          (target as any)[key] = sourceValue
        }
      }
    }
  }

  return deepMerge(target, ...sources)
}

function isObject(item: unknown): item is Record<string, unknown> {
  return (item && typeof item === 'object' && !Array.isArray(item)) as boolean
}

export function debugLog(state: ProcessingState, category: string, message: string): void {
  // eslint-disable-next-line no-console
  console.debug(`[dtsx:${category}] ${message}`)

  // Track in debug state
  if (category === 'default-export') {
    state.debug.exports.default.push(message)
  }
  else if (category === 'named-export') {
    state.debug.exports.named.push(message)
  }
  else if (category === 'declaration') {
    state.debug.declarations.push(message)
  }
}

/**
 * Combine types into a union or intersection, wrapping function types in parentheses
 */
export function combineTypes(types: string[], operator: '|' | '&' = '|'): string {
  const uniqueTypes = [...new Set(types)]
  const normalizedTypes = uniqueTypes.map(type => isFunctionType(type) ? `(${type})` : type)
  return normalizedTypes.join(` ${operator} `)
}

export function parseMethodSignature(value: string): MethodSignature | null {
  // Match async methods
  const asyncMatch = value.match(/^async\s+([^<(]+)(?:<([^>]+)>)?\s*\(([\s\S]*?)\)(?:\s*:\s*([\s\S]+))?$/)
  if (asyncMatch) {
    const [, name, generics, params, returnType] = asyncMatch
    return {
      name,
      async: true,
      generics: generics || '',
      params,
      returnType: returnType || 'Promise<void>',
    }
  }

  // Match regular methods
  const methodMatch = value.match(/^([^<(]+)(?:<([^>]+)>)?\s*\(([\s\S]*?)\)(?:\s*:\s*([\s\S]+))?$/)
  if (methodMatch) {
    const [, name, generics, params, returnType] = methodMatch
    return {
      name,
      async: false,
      generics: generics || '',
      params,
      returnType: returnType || 'void',
    }
  }

  return null
}

/**
 * Normalizes type references by cleaning up whitespace
 */
export function normalizeType(type: string): string {
  return type
    .replace(/\s+/g, ' ')
    .replace(/\s*([<>])\s*/g, '$1')
    .replace(/\s*,\s*/g, ', ')
    .trim()
}

/**
 * Split array elements while preserving nested structures
 */
export function splitArrayElements(content: string): string[] {
  const elements: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = content[i - 1]

    // Handle string literals
    if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '[' || char === '{' || char === '(') {
        depth++
      }
      else if (char === ']' || char === '}' || char === ')') {
        depth--
      }

      if (char === ',' && depth === 0) {
        elements.push(current.trim())
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    elements.push(current.trim())
  }

  return elements
}

export function splitObjectProperties(content: string): string[] {
  const properties: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = content[i - 1]

    // Handle string literals
    if ((char === '"' || char === '\'') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '{' || char === '[' || char === '(') {
        depth++
      }
      else if (char === '}' || char === ']' || char === ')') {
        depth--
      }

      if (char === ',' && depth === 0) {
        properties.push(current.trim())
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    properties.push(current.trim())
  }

  return properties
}

export function shouldProcessLine(line: string): boolean {
  return line.startsWith('export {') || line.startsWith('export *')
}

/**
 * Clean source code by removing single-line comments and normalizing content
 */
export function cleanSource(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      // Remove single line comments
      const commentIndex = line.indexOf('//')
      if (commentIndex !== -1) {
        // Keep the line if there's content before the comment
        const beforeComment = line.substring(0, commentIndex).trim()
        return beforeComment || ''
      }
      return line
    })
    .filter(Boolean) // Remove empty lines
    .join('\n')
}
