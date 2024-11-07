import type { DtsGenerationConfig, DtsGenerationOption } from './types'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, parse, relative } from 'node:path'
import { glob } from 'tinyglobby'
import { config } from './config'
import { extract } from './extract'
import { checkIsolatedDeclarations, getAllTypeScriptFiles, writeToFile } from './utils'

/**
 * Generate declaration files from TypeScript files.
 * @param options - Generation options.
 * @returns Promise<void>
 * @example ```ts
 * // Generate declaration files from all TypeScript files in the src directory.
 * const options = {
 *   cwd: process.cwd(),
 *   root: './src',
 *   outdir: './dist',
 *   clean: true,
 *   verbose: false,
 * }
 *
 * await generateDeclarationsFromFiles(options)
 */
export async function generateDeclarationsFromFiles(options?: DtsGenerationConfig): Promise<void> {
  try {
    // Check for isolatedModules setting
    const isIsolatedDeclarations = await checkIsolatedDeclarations(options)
    if (!isIsolatedDeclarations) {
      console.error('Error: isolatedModules must be set to true in your tsconfig.json. Ensure `tsc --noEmit` does not output any errors.')
      return
    }

    if (options?.clean) {
      await rm(options.outdir, { recursive: true, force: true })
    }

    let files: string[]
    if (options?.entrypoints) {
      files = await glob(options.entrypoints, { cwd: options.root ?? `${options.cwd}/src`, absolute: true })
    }
    else {
      files = await getAllTypeScriptFiles(options?.root ?? `${options?.cwd}/src`)
    }

    for (const file of files) {
      const fileDeclarations = await extract(file)

      if (fileDeclarations) {
        const relativePath = relative(options?.root ?? './src', file)
        const parsedPath = parse(relativePath)
        const outputPath = join(options?.outdir ?? './dist', `${parsedPath.name}.d.ts`)

        // Ensure the directory exists
        await mkdir(dirname(outputPath), { recursive: true })

        // Write the declarations without additional formatting
        await writeToFile(outputPath, fileDeclarations)
      }
      else {
        console.warn(`No declarations extracted for ${file}`)
      }
    }
  }
  catch (error) {
    console.error('Error generating declarations:', error)
  }
}

/**
 * Generate TypeScript declaration files.
 * @param options - Generation options.
 * @returns Promise<void>
 * @example ```ts
 * // Generate declaration files from all TypeScript files in the src directory.
 * const options = {
 *   cwd: process.cwd(),
 *   root: './src',
 *   outdir: './dist',
 *   clean: true,
 *   verbose: false,
 * }
 *
 * await generate(options)
 */
export async function generate(options?: DtsGenerationOption): Promise<void> {
  await generateDeclarationsFromFiles({ ...config, ...options })
}
