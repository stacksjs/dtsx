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

export function formatDeclarations(declarations: string, isConfigFile: boolean): string {
  if (isConfigFile) {
    return declarations
      .replace(/\n{3,}/g, '\n\n')
      .replace(/(\w+):\s+/g, '$1: ')
      .trim() + '\n'
  }

  return declarations
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(\w+):\s+/g, '$1: ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\{\s*\n\s*\n/g, '{\n')
    .replace(/\n\s*\}/g, '\n}')
    .replace(/;\s*\n/g, '\n')
    .replace(/export interface ([^\{]+)\{/g, 'export interface $1{ ')
    .replace(/^(\s*\w+:.*(?:\n|$))/gm, '  $1')
    .replace(/}\n\n(?=\/\*\*|export (interface|type))/g, '}\n\n')
    .replace(/^(import .*\n)+/m, match => match.trim() + '\n\n')
    .replace(/(\/\*\*[\s\S]*?\*\/\s*)(export\s+(?:interface|type|const))/g, '$1\n$2')
    .replace(/\*\/\n\n/g, '*/\n') // Remove extra newline after comment
    .replace(/\* \//g, '*/') // Ensure proper closing of comments
    .trim() + '\n'
}

export function formatComment(comment: string): string {
  return comment
    .replace(/^\/\*\*\s*\n?/, '/**\n * ')
    .replace(/^[\t ]*\*[\t ]?/gm, ' * ')
    .replace(/\s*\*\/\s*$/, '\n */')
    .replace(/^\s*\* $/gm, ' *')
    .replace(/\* \//g, '*/')
    .replace(/\n \* \n/g, '\n *\n')
    .trim();
}
