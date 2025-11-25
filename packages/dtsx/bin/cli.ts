import type { DtsGenerationConfig, DtsGenerationOption } from '../src/types'
import type { LogLevel } from '../src/logger'
import { resolve } from 'node:path'
import process from 'node:process'
import { CLI } from '@stacksjs/clapp'
import { version } from '../../../package.json'
import { generate } from '../src/generator'

const cli = new CLI('dtsx')

const defaultOptions: DtsGenerationConfig = {
  cwd: process.cwd(),
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: false,
  tsconfigPath: 'tsconfig.json',
  verbose: false,
  importOrder: ['bun'],
  dryRun: false,
  stats: false,
  continueOnError: false,
  logLevel: 'info',
  exclude: [],
  outputFormat: 'text',
  progress: false,
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
  .option('--verbose', 'Enable verbose logging', { default: defaultOptions.verbose })
  .option('--import-order <patterns>', 'Import order priority patterns (comma-separated)', {
    default: defaultOptions.importOrder?.join(','),
    type: [String],
  })
  .option('--dry-run', 'Show what would be generated without writing files', { default: defaultOptions.dryRun })
  .option('--stats', 'Show statistics after generation', { default: defaultOptions.stats })
  .option('--continue-on-error', 'Continue processing other files if one fails', { default: defaultOptions.continueOnError })
  .option('--log-level <level>', 'Log level (debug, info, warn, error, silent)', { default: defaultOptions.logLevel })
  .option('--exclude <patterns>', 'Glob patterns to exclude (comma-separated)', {
    default: defaultOptions.exclude?.join(','),
    type: [String],
  })
  .option('--output-format <format>', 'Output format: text or json', { default: defaultOptions.outputFormat })
  .option('--progress', 'Show progress during generation', { default: defaultOptions.progress })
  .example('dtsx generate')
  .example('dtsx generate --entrypoints src/index.ts,src/utils.ts --outdir dist/types')
  .example('dtsx generate --import-order "node:,bun,@myorg/"')
  .example('dtsx generate --dry-run --stats')
  .example('dtsx generate --exclude "**/*.test.ts,**/__tests__/**"')
  .example('dtsx generate --stats --output-format json')
  .action(async (options: DtsGenerationOption) => {
    try {
      const config: DtsGenerationConfig = {
        entrypoints: options.entrypoints ? options.entrypoints : defaultOptions.entrypoints,
        cwd: resolve(options.cwd || defaultOptions.cwd),
        root: resolve(options.root || defaultOptions.root),
        outdir: resolve(options.outdir || defaultOptions.outdir),
        tsconfigPath: resolve(options.tsconfigPath || defaultOptions.tsconfigPath),
        keepComments: options.keepComments ?? defaultOptions.keepComments,
        clean: options.clean ?? defaultOptions.clean,
        verbose: options.verbose ?? defaultOptions.verbose,
        importOrder: options.importOrder || defaultOptions.importOrder,
        dryRun: options.dryRun ?? defaultOptions.dryRun,
        stats: options.stats ?? defaultOptions.stats,
        continueOnError: options.continueOnError ?? defaultOptions.continueOnError,
        logLevel: (options.logLevel as LogLevel) ?? defaultOptions.logLevel,
        exclude: options.exclude ? options.exclude.flatMap((p: string) => p.split(',').map(s => s.trim()).filter(Boolean)) : defaultOptions.exclude,
        outputFormat: (options.outputFormat as 'text' | 'json') ?? defaultOptions.outputFormat,
        progress: options.progress ?? defaultOptions.progress,
      }

      const stats = await generate(config)

      // Exit with appropriate code based on results
      if (stats.filesFailed > 0 && stats.filesGenerated === 0) {
        // All files failed
        process.exit(1)
      }
      else if (stats.filesFailed > 0) {
        // Some files failed (partial success)
        process.exit(2)
      }
      // Success - exit code 0 (default)
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
