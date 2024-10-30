import type { DtsGenerationConfig } from './types'
import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import process from 'node:process'
import { config } from './config'

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
