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

export function formatDeclarations(declarations: string): string {
  const lines = declarations.split('\n')
  const formattedLines = lines.map(line => {
    // Trim trailing spaces
    line = line.trimEnd()

    // Handle interface and type declarations
    if (line.startsWith('export interface') || line.startsWith('export type')) {
      const parts = line.split('{')
      if (parts.length > 1) {
        return `${parts[0].trim()} {${parts[1]}`
      }
    }

    // Remove semicolons from the end of lines
    if (line.endsWith(';')) {
      line = line.slice(0, -1)
    }

    return line
  })

  // Join lines and ensure only one blank line between declarations
  let result = formattedLines.join('\n')
  result = result.replace(/\n{3,}/g, '\n\n')

  // Format comments
  result = result.replace(/\/\*\*\n([^*]*)(\n \*\/)/g, (match, content) => {
    const formattedContent = content
      .split('\n')
      .map(line => ` *${line.trim() ? ' ' + line.trim() : ''}`)
      .join('\n')
    return `/**\n${formattedContent}\n */`
  })

  return result.trim() + '\n'
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
