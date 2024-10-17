import type { Result } from 'neverthrow'
import type { DtsGenerationConfig, DtsGenerationOption } from './types'
import { rm, mkdir } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { err, ok } from 'neverthrow'
import { config } from './config'
import { writeToFile, getAllTypeScriptFiles, checkIsolatedDeclarations, formatDeclarations } from './utils'
import { extractTypeFromSource, extractConfigTypeFromSource, extractIndexTypeFromSource } from './extract'

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

function validateOptions(options: unknown): Result<DtsGenerationOption, Error> {
  if (typeof options === 'object' && options !== null) {
    return ok(options as DtsGenerationOption)
  }

  return err(new Error('Invalid options'))
}
