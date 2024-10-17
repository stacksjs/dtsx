import type { Result } from 'neverthrow'
import type { DtsGenerationConfig, DtsGenerationOption } from './types'
import { readFile, rm, mkdir } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { err, ok } from 'neverthrow'
import { config } from './config'
import { writeToFile, getAllTypeScriptFiles, checkIsolatedDeclarations } from './utils'

export async function generateDeclarationsFromFiles(options: DtsGenerationConfig = config): Promise<void> {
  // Check for isolatedModules setting
  const isIsolatedDeclarations = await checkIsolatedDeclarations(options)
  if (!isIsolatedDeclarations) {
    console.error('Error: isolatedModules must be set to true in your tsconfig.json. Ensure `tsc --noEmit` does not output any errors.')
    return
  }

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

export async function generate(options?: DtsGenerationOption): Promise<void> {
  await generateDeclarationsFromFiles({ ...config, ...options })
}

async function extractTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''
  let imports = new Set<string>()

  // Handle imported types
  const importRegex = /import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g
  let importMatch
  while ((importMatch = importRegex.exec(fileContent)) !== null) {
    const types = importMatch[1].split(',').map(t => t.trim())
    const from = importMatch[2]
    types.forEach(type => imports.add(`${type}:${from}`))
  }

  // Handle exported functions with comments
  const exportedFunctionRegex = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^{]+))/g
  let match
  while ((match = exportedFunctionRegex.exec(fileContent)) !== null) {
    const [, comment, , isAsync, name, params, returnType] = match
    const cleanParams = params.replace(/\s*=\s*[^,)]+/g, '')
    const declaration = `${comment || ''}export declare ${isAsync || ''}function ${name}(${cleanParams}): ${returnType.trim()}`
    declarations += `${declaration}\n\n`

    // Check for types used in the declaration and add them to imports
    const usedTypes = [...params.matchAll(/(\w+):\s*([A-Z]\w+)/g), ...returnType.matchAll(/\b([A-Z]\w+)\b/g)]
    usedTypes.forEach(([, , type]) => {
      if (type) imports.add(type)
    })
  }

  // Handle other exports (interface, type, const)
  const otherExportRegex = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+((?:interface|type|const)\s+\w+(?:\s*=\s*[^;]+|\s*\{[^}]*\})));?/gs
  while ((match = otherExportRegex.exec(fileContent)) !== null) {
    const [, comment, exportStatement, declaration] = match
    if (declaration.startsWith('interface') || declaration.startsWith('type')) {
      declarations += `${comment || ''}${exportStatement}\n\n`
    } else if (declaration.startsWith('const')) {
      const [, name, type] = declaration.match(/const\s+(\w+):\s*([^=]+)/) || []
      if (name && type) {
        declarations += `${comment || ''}export declare const ${name}: ${type.trim()}\n\n`
      }
    }

    // Check for types used in the declaration and add them to imports
    const usedTypes = declaration.match(/\b([A-Z]\w+)\b/g) || []
    usedTypes.forEach(type => imports.add(type))
  }

  // Generate import statements for used types
  let importDeclarations = ''
  const importMap = new Map()
  imports.forEach(typeWithPath => {
    const [type, path] = typeWithPath.split(':')
    if (path) {
      if (!importMap.has(path)) importMap.set(path, new Set())
      importMap.get(path).add(type)
    }
  })
  importMap.forEach((types, path) => {
    importDeclarations += `import type { ${Array.from(types).join(', ')} } from '${path}'\n`
  })

  if (importDeclarations) {
    declarations = importDeclarations + '\n' + declarations
  }

  return declarations.trim() + '\n'
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
    .replace(/}\n\n(?=\/\*\*|export (interface|type))/g, '}\n')
    .replace(/^(import .*\n)+/m, match => match.trim() + '\n')
    .trim() + '\n'
}

function validateOptions(options: unknown): Result<DtsGenerationOption, Error> {
  if (typeof options === 'object' && options !== null) {
    return ok(options as DtsGenerationOption)
  }

  return err(new Error('Invalid options'))
}
