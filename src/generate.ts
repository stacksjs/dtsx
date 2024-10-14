import type { Result } from 'neverthrow'
import type { DtsGenerationConfig, DtsGenerationOption } from './types'
import { readdir, readFile, rm, mkdir } from 'node:fs/promises'
import { extname, join, relative, dirname } from 'node:path'
import { err, ok } from 'neverthrow'
import { config } from './config'

function validateOptions(options: unknown): Result<DtsGenerationOption, Error> {
  if (typeof options === 'object' && options !== null) {
    return ok(options as DtsGenerationOption)
  }

  return err(new Error('Invalid options'))
}

async function extractTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''
  let imports = new Set()

  // Handle exports
  const exportRegex = /export\s+((?:interface|type|const|function|async function)\s+\w+(?:\s*=\s*[^;]+|\s*\{[^}]*\}|\s*\([^)]*\)[^;]*));?/gs
  let match
  while ((match = exportRegex.exec(fileContent)) !== null) {
    const declaration = match[1].trim()
    if (declaration.startsWith('interface') || declaration.startsWith('type')) {
      declarations += `export ${declaration}\n\n`
    } else if (declaration.startsWith('const')) {
      const [, name, type] = declaration.match(/const\s+(\w+):\s*([^=]+)/) || []
      if (name && type) {
        declarations += `export declare const ${name}: ${type.trim()}\n\n`
      }
    } else if (declaration.startsWith('function') || declaration.startsWith('async function')) {
      const funcMatch = declaration.match(/(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^{]+)/)
      if (funcMatch) {
        const [, isAsync, name, params, returnType] = funcMatch
        // Remove default values in parameters
        const cleanParams = params.replace(/\s*=\s*[^,)]+/g, '')
        declarations += `export declare ${isAsync || ''}function ${name}(${cleanParams}): ${returnType.trim()}\n\n`
      }
    }

    // Check for types used in the declaration and add them to imports
    const usedTypes = declaration.match(/\b([A-Z]\w+)\b/g) || []
    usedTypes.forEach(type => imports.add(type))
  }

  // Only include imports for types that are actually used
  const importRegex = /import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g
  let importDeclarations = ''
  while ((match = importRegex.exec(fileContent)) !== null) {
    const types = match[1].split(',').map(t => t.trim())
    const from = match[2]
    const usedTypes = types.filter(type => imports.has(type))
    if (usedTypes.length > 0) {
      importDeclarations += `import type { ${usedTypes.join(', ')} } from '${from}'\n`
    }
  }

  if (importDeclarations) {
    declarations = importDeclarations + '\n\n' + declarations  // Add two newlines here
  }

  // Add a special marker between imports and exports
  return declarations.replace(/\n(export)/, '\n###LINEBREAK###$1').trim() + '\n'
}

async function extractConfigTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''

  // Handle type imports
  const importRegex = /import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g
  let importMatch
  while ((importMatch = importRegex.exec(fileContent)) !== null) {
    const types = importMatch[1].split(',').map(t => t.trim())
    const from = importMatch[2]
    declarations += `import type { ${types.join(', ')} } from '${from}'\n\n`  // Add two newlines here
  }

  // Handle exports
  const exportRegex = /export\s+const\s+(\w+)\s*:\s*([^=]+)\s*=/g
  let exportMatch
  while ((exportMatch = exportRegex.exec(fileContent)) !== null) {
    const [, name, type] = exportMatch
    declarations += `export declare const ${name}: ${type.trim()}\n`
  }

  return declarations.trim() + '\n'
}

async function extractIndexTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''

  // Handle re-exports
  const reExportRegex = /export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g
  let match
  while ((match = reExportRegex.exec(fileContent)) !== null) {
    declarations += `${match[0]}\n`
  }

  return declarations.trim() + '\n'
}

function formatDeclarations(declarations: string, isConfigFile: boolean): string {
  if (isConfigFile) {
    // Special formatting for config.d.ts
    return declarations
      .replace(/\n{3,}/g, '\n\n')  // Remove excess newlines, but keep doubles
      .replace(/(\w+):\s+/g, '$1: ')  // Ensure single space after colon
      .trim() + '\n'  // Ensure final newline
  }

  // Regular formatting for other files
  return declarations
    .replace(/\n{3,}/g, '\n\n')  // Remove excess newlines, but keep doubles
    .replace(/(\w+):\s+/g, '$1: ')  // Ensure single space after colon
    .replace(/\s*\n\s*/g, '\n')  // Remove extra spaces around newlines
    .replace(/\{\s*\n\s*\n/g, '{\n')  // Remove extra newline after opening brace
    .replace(/\n\s*\}/g, '\n}')  // Remove extra space before closing brace
    .replace(/;\s*\n/g, '\n')  // Remove semicolons at end of lines
    .replace(/export interface ([^\{]+)\{/g, 'export interface $1{ ')  // Add space after opening brace for interface
    .replace(/^(\s*\w+:.*(?:\n|$))/gm, '  $1')  // Ensure all properties in interface are indented
    .replace(/}\n\n(?=export (interface|type))/g, '}\n')  // Remove extra newline between interface/type declarations
    .replace(/^(import .*\n)+/m, match => match.trim() + '\n')  // Ensure imports are grouped
    .replace(/###LINEBREAK###/g, '\n')  // Replace the special marker with a newline
    .replace(/\n{3,}/g, '\n\n')  // Final pass to remove any triple newlines
    .trim() + '\n'  // Ensure final newline
}

export async function generateDeclarationsFromFiles(options: DtsGenerationConfig = config): Promise<void> {
  if (options.clean) {
    console.log('Cleaning output directory...')
    await rm(options.outdir, { recursive: true, force: true })
  }

  const validationResult = validateOptions(options)

  if (validationResult.isErr()) {
    console.error(validationResult.error.message)
    return
  }

  const files = await getAllTypeScriptFiles(options.root)
  console.log('Found the following TypeScript files:', files)

  for (const file of files) {
    console.log(`Processing file: ${file}`)
    let fileDeclarations
    const isConfigFile = file.endsWith('config.ts')
    const isIndexFile = file.endsWith('index.ts')
    if (isConfigFile) {
      fileDeclarations = await extractConfigTypeFromSource(file)
    } else if (isIndexFile) {
      fileDeclarations = await extractIndexTypeFromSource(file)
    } else {
      fileDeclarations = await extractTypeFromSource(file)
    }

    if (fileDeclarations) {
      const relativePath = relative(options.root, file)
      const outputPath = join(options.outdir, relativePath.replace(/\.ts$/, '.d.ts'))

      // Ensure the directory exists
      await mkdir(dirname(outputPath), { recursive: true })

      // Format and write the declarations
      const formattedDeclarations = formatDeclarations(fileDeclarations, isConfigFile)
      await writeToFile(outputPath, formattedDeclarations)

      console.log(`Generated ${outputPath}`)
    }
  }


  console.log('Declaration file generation complete')
}

async function getAllTypeScriptFiles(directory?: string): Promise<string[]> {
  const dir = directory ?? config.root
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
