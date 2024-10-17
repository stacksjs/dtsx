import type { DtsGenerationConfig, DtsGenerationOption } from './types'
import { rm, mkdir } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { config } from './config'
import { writeToFile, getAllTypeScriptFiles, checkIsolatedDeclarations } from './utils'
import { extractTypeFromSource } from './extract'

export async function generateDeclarationsFromFiles(options: DtsGenerationConfig = config): Promise<void> {
  try {
    // Check for isolatedModules setting
    const isIsolatedDeclarations = await checkIsolatedDeclarations(options)
    if (!isIsolatedDeclarations) {
      console.error('Error: isolatedModules must be set to true in your tsconfig.json. Ensure `tsc --noEmit` does not output any errors.')
      return
    }

    if (options.clean) {
      // console.log('Cleaning output directory...')
      await rm(options.outdir, { recursive: true, force: true })
    }

    const files = await getAllTypeScriptFiles(options.root)
    // console.log('Found the following TypeScript files:', files)

    for (const file of files) {
      // console.log(`Processing file: ${file}`)
      const fileDeclarations = await extractTypeFromSource(file)

      if (fileDeclarations) {
        const relativePath = relative(options.root, file)
        const outputPath = join(options.outdir, relativePath.replace(/\.ts$/, '.d.ts'))

        // Ensure the directory exists
        await mkdir(dirname(outputPath), { recursive: true })

        // Write the declarations without additional formatting
        await writeToFile(outputPath, fileDeclarations)

        // console.log(`Generated ${outputPath}`)
      } else {
        console.warn(`No declarations extracted for ${file}`)
      }
    }

    // console.log('Declaration file generation complete')
  } catch (error) {
    console.error('Error generating declarations:', error)
  }
}

export async function generate(options?: DtsGenerationOption): Promise<void> {
  await generateDeclarationsFromFiles({ ...config, ...options })
}
