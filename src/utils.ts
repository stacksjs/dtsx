import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { config } from './config'
import { type DtsGenerationConfig } from './types'

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

export async function checkIsolatedDeclarations(options: DtsGenerationConfig): Promise<boolean> {
  try {
    const tsconfigPath = options.tsconfigPath || join(options.root, 'tsconfig.json')
    const tsconfigContent = await readFile(tsconfigPath, 'utf-8')
    const tsconfig = JSON.parse(tsconfigContent)

    return tsconfig.compilerOptions?.isolatedDeclarations === true
  } catch (error) {
    return false
  }
}
