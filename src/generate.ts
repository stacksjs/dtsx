import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import process from 'node:process'
import { config } from './config'
import type { DtsGenerationOption, DtsGenerationOptions } from './types'
import { ok, err, Result } from 'neverthrow'

function validateOptions(options: unknown): Result<DtsGenerationOptions, Error> {
  if (typeof options === 'object' && options !== null) {
    return ok(options as DtsGenerationOptions)
  }

  return err(new Error('Invalid options'))
}

async function extractTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  const constRegex = /export const (\w+):\s*([^=]+)\s*=\s*\{[^}]*\};/g
  const interfaceRegex = /export interface (\w+)\s*\{([^}]*)\}/g
  const typeRegex = /export type (\w+)\s*=\s*([^;]+);/g

  let match
  let declarations = ''

  while ((match = constRegex.exec(fileContent)) !== null) {
    const variableName = match[1]
    const type = match[2].trim()
    declarations += `export declare const ${variableName}: ${type};\n`
  }

  while ((match = interfaceRegex.exec(fileContent)) !== null) {
    const interfaceName = match[1]
    const interfaceBody = match[2].trim()
    declarations += `export interface ${interfaceName} {${interfaceBody}}\n`
  }

  while ((match = typeRegex.exec(fileContent)) !== null) {
    const typeName = match[1]
    const typeBody = match[2].trim()
    declarations += `export type ${typeName} = ${typeBody};\n`
  }

  return declarations
}

export async function generateDeclarationsFromFiles(
  dir: string,
  options: DtsGenerationOptions = config
): Promise<void | string> {
  const validationResult = validateOptions(options)

  if (validationResult.isErr()) {
    console.error(validationResult.error.message)
    return
  }

  const files = await getAllTypeScriptFiles(dir)
  let bundledDeclarations = ''

  for (const file of files) {
    bundledDeclarations += await extractTypeFromSource(file)
  }

  if (process.env.APP_ENV === 'test') {
    return bundledDeclarations
  }

  const outputPath = join(dir, 'types.d.ts')
  await writeToFile(outputPath, bundledDeclarations)

  console.log(`Bundled .d.ts file generated at ${outputPath}`)
}

async function getAllTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })

  const files = await Promise.all(entries.map((entry) => {
    const res = join(dir, entry.name)
    return entry.isDirectory() ? getAllTypeScriptFiles(res) : res
  }))

  return Array.prototype.concat(...files).filter(file => extname(file) === '.ts')
}

async function writeToFile(filePath: string, content: string): Promise<void> {
  await Bun.write(filePath, content)
}
