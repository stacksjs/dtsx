#!/usr/bin/env bun

import type { DtsGenerationConfig } from './types'
import { resolve } from 'node:path'
import process from 'node:process'
import { existsSync } from 'node:fs'
import { CAC } from 'cac'
import { config as defaultConfig } from './config'
import { generate } from './generator'
import { version } from '../package.json'

// Validate and resolve paths
function validateAndResolvePath(path: string, description: string): string {
  const resolved = resolve(process.cwd(), path)
  
  // For tsconfig, check if file exists
  if (description.includes('tsconfig') && !existsSync(resolved)) {
    console.warn(`Warning: ${description} not found at ${resolved}`)
  }
  
  return resolved
}

// Parse entrypoints from string or array
function parseEntrypoints(entrypoints: string | string[] | undefined): string[] {
  if (!entrypoints) {
    return defaultConfig.entrypoints
  }
  
  if (typeof entrypoints === 'string') {
    return entrypoints.split(',').map(e => e.trim()).filter(Boolean)
  }
  
  return Array.isArray(entrypoints) ? entrypoints : [entrypoints]
}

// Main CLI setup
async function setupCLI() {
  const cli = new CAC('dtsx')

  // Set version
  cli.version(version)

  // Default command (generate)
  cli
    .command('[entrypoints...]', 'Generate TypeScript declaration files', {
      allowUnknownOptions: false,
    })
    .option('-r, --root <dir>', 'Root directory to scan for TypeScript files', {
      default: defaultConfig.root,
    })
    .option('-o, --outdir <dir>', 'Output directory for generated .d.ts files', {
      default: defaultConfig.outdir,
    })
    .option('-c, --clean', 'Clean output directory before generation', {
      default: defaultConfig.clean,
    })
    .option('--keep-comments [value]', 'Keep comments in generated .d.ts files (default: true)', {
       default: defaultConfig.keepComments,
     })
    .option('--tsconfig <path>', 'Path to tsconfig.json file', {
      default: defaultConfig.tsconfigPath,
    })
    .option('--verbose', 'Enable verbose logging', {
      default: defaultConfig.verbose,
    })
    .option('--output-structure <type>', 'Output structure: "mirror" or "flat"', {
      default: defaultConfig.outputStructure || 'mirror',
    })
    .example('dtsx')
    .example('dtsx src/index.ts src/utils.ts')
    .example('dtsx -r lib -o types --clean')
    .example('dtsx --keep-comments=false --verbose')
    .example('dtsx "src/**/*.ts" --output-structure flat')
    .action(async (entrypoints: string[], options: any) => {
             try {
         // Handle comment options
         let keepComments = defaultConfig.keepComments
         if (options.keepComments !== undefined) {
           // Handle --keep-comments=false or --keep-comments false
           if (options.keepComments === 'false' || options.keepComments === false) {
             keepComments = false
           } else if (options.keepComments === 'true' || options.keepComments === true) {
             keepComments = true
           }
         }

        // Validate output structure
        const validStructures = ['mirror', 'flat']
        if (options.outputStructure && !validStructures.includes(options.outputStructure)) {
          console.error(`Error: Invalid output structure "${options.outputStructure}". Must be one of: ${validStructures.join(', ')}`)
          process.exit(1)
        }

        // Build configuration
         const finalEntrypoints = entrypoints.length > 0 ? entrypoints : parseEntrypoints(defaultConfig.entrypoints)
         const config: DtsGenerationConfig = {
           cwd: process.cwd(),
           root: validateAndResolvePath(options.root, 'root directory'),
           entrypoints: Array.isArray(finalEntrypoints) ? finalEntrypoints : [finalEntrypoints],
           outdir: validateAndResolvePath(options.outdir, 'output directory'),
           keepComments,
           clean: options.clean,
           tsconfigPath: validateAndResolvePath(options.tsconfig, 'tsconfig.json'),
           verbose: options.verbose,
           outputStructure: options.outputStructure as 'mirror' | 'flat',
         }

        // Show configuration if verbose
        if (config.verbose) {
          console.log('🔧 Configuration:')
          console.log(`   Root: ${config.root}`)
          console.log(`   Output: ${config.outdir}`)
          console.log(`   Entrypoints: ${config.entrypoints.join(', ')}`)
          console.log(`   Keep comments: ${config.keepComments}`)
          console.log(`   Clean: ${config.clean}`)
          console.log(`   Output structure: ${config.outputStructure}`)
          console.log(`   TSConfig: ${config.tsconfigPath}`)
          console.log('')
        }

        // Run generation
        await generate(config)
        
        if (!config.verbose) {
          console.log('✅ DTS generation completed successfully!')
        }
      } catch (error) {
        console.error('❌ Error generating .d.ts files:', error)
        process.exit(1)
      }
    })

  // Explicit generate command for compatibility
  cli
    .command('generate [entrypoints...]', 'Generate TypeScript declaration files')
    .option('--cwd <path>', 'Current working directory', {
      default: process.cwd(),
    })
    .option('-r, --root <path>', 'Root directory to scan for TypeScript files', {
      default: defaultConfig.root,
    })
    .option('-o, --outdir <path>', 'Output directory for generated .d.ts files', {
      default: defaultConfig.outdir,
    })
    .option('-c, --clean', 'Clean output directory before generation', {
      default: defaultConfig.clean,
    })
    .option('--keep-comments [value]', 'Keep comments in generated .d.ts files (default: true)', {
       default: defaultConfig.keepComments,
    })
    .option('--tsconfig <path>', 'Path to tsconfig.json file', {
      default: defaultConfig.tsconfigPath,
    })
    .option('--verbose', 'Enable verbose logging', {
      default: defaultConfig.verbose,
    })
    .option('--output-structure <type>', 'Output structure: "mirror" or "flat"', {
      default: defaultConfig.outputStructure || 'mirror',
    })
    .example('dtsx generate')
    .example('dtsx generate src/index.ts --outdir dist/types')
    .example('dtsx generate --keep-comments=false --verbose')
    .action(async (entrypoints: string[], options: any) => {
      try {
        // Handle comment options
        let keepComments = defaultConfig.keepComments
        if (options.keepComments !== undefined) {
          // Handle --keep-comments=false or --keep-comments false
          if (options.keepComments === 'false' || options.keepComments === false) {
            keepComments = false
          } else if (options.keepComments === 'true' || options.keepComments === true) {
            keepComments = true
          }
        }

        // Validate output structure
        const validStructures = ['mirror', 'flat']
        if (options.outputStructure && !validStructures.includes(options.outputStructure)) {
          console.error(`Error: Invalid output structure "${options.outputStructure}". Must be one of: ${validStructures.join(', ')}`)
          process.exit(1)
        }

        // Build configuration
        const finalEntrypoints = entrypoints.length > 0 ? entrypoints : parseEntrypoints(defaultConfig.entrypoints)
        const config: DtsGenerationConfig = {
          cwd: validateAndResolvePath(options.cwd, 'working directory'),
          root: validateAndResolvePath(options.root, 'root directory'),
          entrypoints: Array.isArray(finalEntrypoints) ? finalEntrypoints : [finalEntrypoints],
          outdir: validateAndResolvePath(options.outdir, 'output directory'),
          keepComments,
          clean: options.clean,
          tsconfigPath: validateAndResolvePath(options.tsconfig, 'tsconfig.json'),
          verbose: options.verbose,
          outputStructure: options.outputStructure as 'mirror' | 'flat',
        }

        // Show configuration if verbose
        if (config.verbose) {
          console.log('🔧 Configuration:')
          console.log(`   CWD: ${config.cwd}`)
          console.log(`   Root: ${config.root}`)
          console.log(`   Output: ${config.outdir}`)
          console.log(`   Entrypoints: ${config.entrypoints.join(', ')}`)
          console.log(`   Keep comments: ${config.keepComments}`)
          console.log(`   Clean: ${config.clean}`)
          console.log(`   Output structure: ${config.outputStructure}`)
          console.log(`   TSConfig: ${config.tsconfigPath}`)
          console.log('')
        }

        // Run generation
        await generate(config)
        
        if (!config.verbose) {
          console.log('✅ DTS generation completed successfully!')
        }
      } catch (error) {
        console.error('❌ Error generating .d.ts files:', error)
        process.exit(1)
      }
    })

  // Version command
  cli
    .command('version', 'Show version information')
    .action(() => {
      console.log(`dtsx v${version}`)
      console.log('A modern, fast TypeScript declaration file generator')
    })

  // Help customization
  cli.help((sections) => {
    sections.splice(1, 0, {
      title: 'About',
      body: 'dtsx is a modern, fast .d.ts generation tool that preserves comments and provides excellent TypeScript support.',
    })
  })

  return cli
}

// Run CLI
async function main() {
  try {
    const cli = await setupCLI()
    cli.parse()
  } catch (error) {
    console.error('❌ CLI setup error:', error)
    process.exit(1)
  }
}

// Only run if this file is executed directly
if (import.meta.main) {
  main()
}
