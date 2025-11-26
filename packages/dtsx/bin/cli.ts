import type { DtsGenerationConfig, DtsGenerationOption } from '../src/types'
import type { LogLevel } from '../src/logger'
import { resolve } from 'node:path'
import process from 'node:process'
import { CLI } from '@stacksjs/clapp'
import { version } from '../../../package.json'
import { generate, processSource, watch } from '../src/generator'

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
  diff: false,
  validate: false,
  parallel: false,
  concurrency: 4,
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
  .option('--diff', 'Show diff of changes compared to existing files', { default: defaultOptions.diff })
  .option('--validate', 'Validate generated .d.ts files against TypeScript', { default: defaultOptions.validate })
  .option('--parallel', 'Process files in parallel', { default: defaultOptions.parallel })
  .option('--concurrency <number>', 'Number of concurrent workers (with --parallel)', { default: defaultOptions.concurrency })
  .option('--declaration-map', 'Generate declaration map files (.d.ts.map)', { default: false })
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
        diff: options.diff ?? defaultOptions.diff,
        validate: options.validate ?? defaultOptions.validate,
        parallel: options.parallel ?? defaultOptions.parallel,
        concurrency: Number(options.concurrency) || defaultOptions.concurrency,
        declarationMap: options.declarationMap ?? false,
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

cli
  .command('watch', 'Watch for changes and regenerate .d.ts files')
  .option('--cwd <path>', 'Current working directory', { default: defaultOptions.cwd })
  .option('--root <path>', 'Root directory of the project', { default: defaultOptions.root })
  .option('--entrypoints <files>', 'Entry point files (comma-separated)', {
    default: defaultOptions.entrypoints?.join(','),
    type: [String],
  })
  .option('--outdir <path>', 'Output directory for generated .d.ts files', { default: defaultOptions.outdir })
  .option('--keep-comments', 'Keep comments in generated .d.ts files', { default: defaultOptions.keepComments })
  .option('--exclude <patterns>', 'Glob patterns to exclude (comma-separated)', {
    default: defaultOptions.exclude?.join(','),
    type: [String],
  })
  .option('--log-level <level>', 'Log level (debug, info, warn, error, silent)', { default: defaultOptions.logLevel })
  .example('dtsx watch')
  .example('dtsx watch --root src --outdir dist/types')
  .action(async (options: DtsGenerationOption) => {
    try {
      const config: Partial<DtsGenerationConfig> = {
        entrypoints: options.entrypoints ? options.entrypoints : defaultOptions.entrypoints,
        cwd: resolve(options.cwd || defaultOptions.cwd),
        root: resolve(options.root || defaultOptions.root),
        outdir: resolve(options.outdir || defaultOptions.outdir),
        keepComments: options.keepComments ?? defaultOptions.keepComments,
        exclude: options.exclude ? options.exclude.flatMap((p: string) => p.split(',').map(s => s.trim()).filter(Boolean)) : defaultOptions.exclude,
        logLevel: (options.logLevel as LogLevel) ?? defaultOptions.logLevel,
      }

      await watch(config)
    }
    catch (error) {
      console.error('Error in watch mode:', error)
      process.exit(1)
    }
  })

cli
  .command('stdin', 'Process TypeScript from stdin and output .d.ts to stdout')
  .option('--keep-comments', 'Keep comments in generated .d.ts files', { default: true })
  .option('--import-order <patterns>', 'Import order priority patterns (comma-separated)', {
    default: 'bun',
    type: [String],
  })
  .example('echo "export const foo: string = \'bar\'" | dtsx stdin')
  .example('cat src/index.ts | dtsx stdin')
  .action(async (options: { keepComments?: boolean, importOrder?: string[] }) => {
    try {
      // Read from stdin
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk)
      }
      const sourceCode = Buffer.concat(chunks).toString('utf-8')

      if (!sourceCode.trim()) {
        console.error('Error: No input received from stdin')
        process.exit(1)
      }

      let importOrder = ['bun']
      if (options.importOrder) {
        if (Array.isArray(options.importOrder)) {
          importOrder = options.importOrder.flatMap((p: string) => p.split(',').map(s => s.trim()).filter(Boolean))
        }
        else if (typeof options.importOrder === 'string') {
          importOrder = (options.importOrder as string).split(',').map(s => s.trim()).filter(Boolean)
        }
      }

      const dtsContent = processSource(
        sourceCode,
        'stdin.ts',
        options.keepComments ?? true,
        importOrder,
      )

      // Output to stdout
      console.log(dtsContent)
    }
    catch (error) {
      console.error('Error processing stdin:', error)
      process.exit(1)
    }
  })

cli.command('version', 'Show the version of dtsx').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
