import type { DtsGenerationConfig, DtsGenerationOption } from '../src/types'
import { resolve } from 'node:path'
import { CAC } from '@stacksjs/cli'
import { version } from '../package.json'
import { generate } from '../src/generate'

const cli = new CAC('dtsx')

const defaultOptions: DtsGenerationConfig = {
  cwd: process.cwd(),
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: false,
  tsconfigPath: 'tsconfig.json',
}

cli
  .command('generate', 'Generate TypeScript declaration files')
  .option('--cwd <path>', 'Current working directory', { default: defaultOptions.cwd })
  .option('--root <path>', 'Root directory of the project', { default: defaultOptions.root })
  .option('--entrypoints <files>', 'Entry point files (comma-separated)', {
    default: defaultOptions.entrypoints?.join(','),
    type: [String],
  })
  .option('--outdir <path>', 'Output directory for generated .d.ts files', { default: defaultOptions.outdir })
  .option('--keep-comments', 'Keep comments in generated .d.ts files', { default: defaultOptions.keepComments })
  .option('--clean', 'Clean output directory before generation', { default: defaultOptions.clean })
  .option('--tsconfig <path>', 'Path to tsconfig.json', { default: defaultOptions.tsconfigPath })
  // .option('--verbose', 'Enable verbose logging', { default: false })
  .example('dtsx generate')
  .example('dtsx generate --entrypoints src/index.ts,src/utils.ts --outdir dist/types')
  .action(async (options: DtsGenerationOption) => {
    try {
      const config: DtsGenerationConfig = {
        entrypoints: options.entrypoints ? options.entrypoints : defaultOptions.entrypoints,
        cwd: resolve(options.cwd || defaultOptions.cwd),
        root: resolve(options.root || defaultOptions.root),
        outdir: resolve(options.outdir || defaultOptions.outdir),
        tsconfigPath: resolve(options.tsconfigPath || defaultOptions.tsconfigPath),
        keepComments: options.keepComments || defaultOptions.keepComments,
        clean: options.clean || defaultOptions.clean,
      }

      // if (options.verbose) {
      //   console.log('Using options:', mergedOptions)
      // }

      await generate(config)
    }
    catch (error) {
      console.error('Error generating .d.ts files:', error)
      process.exit(1)
    }
  })

cli.command('version', 'Show the version of dtsx').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
