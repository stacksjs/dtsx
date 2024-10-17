import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { formatComment } from './utils'
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

export function formatDeclarations(declarations: string, isConfigFile: boolean): string {
  if (isConfigFile) {
    return declarations.trim() + '\n'
  }

  return declarations
    .replace(/\n{3,}/g, '\n\n')
    .replace(/;\n/g, '\n')
    .replace(/export (interface|type) ([^\{]+)\s*\{\s*\n/g, 'export $1 $2 {\n')
    .replace(/\n\s*\}/g, '\n}')
    .replace(/\/\*\*\n([^*]*)(\n \*\/)/g, (match, content) => {
      const formattedContent = content.split('\n').map((line: string) => ` *${line.trim() ? ' ' + line.trim() : ''}`).join('\n')
      return `/**\n${formattedContent}\n */`
    })
    .trim() + '\n'
}

export function formatComment(comment: string): string {
  const lines = comment.split('\n')
  return lines
    .map((line, index) => {
      if (index === 0) return '/**'
      if (index === lines.length - 1) return ' */'
      const trimmedLine = line.replace(/^\s*\*?\s?/, '').trim()
      return ` * ${trimmedLine}`
    })
    .join('\n')
}
