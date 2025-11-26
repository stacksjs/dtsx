import type { DtsGenerationConfig, DtsGenerationOption } from '../src/types'
import type { LogLevel } from '../src/logger'
import { resolve } from 'node:path'
import process from 'node:process'
import { CLI } from '@stacksjs/clapp'
import { version } from '../../../package.json'
import { getConfig } from '../src/config'
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
  .option('--bundle', 'Bundle all declarations into a single output file', { default: false })
  .option('--bundle-output <file>', 'Output filename when bundling (relative to outdir)', { default: 'index.d.ts' })
  .option('--config <path>', 'Path to config file (dtsx.config.ts)', { default: '' })
  .option('--incremental', 'Enable incremental builds (only regenerate changed files)', { default: false })
  .option('--clear-cache', 'Clear the incremental build cache before generating', { default: false })
  .example('dtsx generate')
  .example('dtsx generate --entrypoints src/index.ts,src/utils.ts --outdir dist/types')
  .example('dtsx generate --import-order "node:,bun,@myorg/"')
  .example('dtsx generate --dry-run --stats')
  .example('dtsx generate --exclude "**/*.test.ts,**/__tests__/**"')
  .example('dtsx generate --stats --output-format json')
  .example('dtsx generate --bundle --bundle-output types.d.ts')
  .action(async (options: DtsGenerationOption & { config?: string }) => {
    try {
      // Load config from file first (CLI options override config file)
      const cwd = resolve(options.cwd || defaultOptions.cwd)
      const fileConfig = await getConfig(cwd)

      // Merge: defaultOptions < fileConfig < CLI options
      const config: DtsGenerationConfig = {
        entrypoints: options.entrypoints ? options.entrypoints : (fileConfig.entrypoints || defaultOptions.entrypoints),
        cwd,
        root: resolve(options.root || fileConfig.root || defaultOptions.root),
        outdir: resolve(options.outdir || fileConfig.outdir || defaultOptions.outdir),
        tsconfigPath: resolve(options.tsconfigPath || fileConfig.tsconfigPath || defaultOptions.tsconfigPath),
        keepComments: options.keepComments ?? fileConfig.keepComments ?? defaultOptions.keepComments,
        clean: options.clean ?? fileConfig.clean ?? defaultOptions.clean,
        verbose: options.verbose ?? fileConfig.verbose ?? defaultOptions.verbose,
        importOrder: options.importOrder || fileConfig.importOrder || defaultOptions.importOrder,
        dryRun: options.dryRun ?? fileConfig.dryRun ?? defaultOptions.dryRun,
        stats: options.stats ?? fileConfig.stats ?? defaultOptions.stats,
        continueOnError: options.continueOnError ?? fileConfig.continueOnError ?? defaultOptions.continueOnError,
        logLevel: (options.logLevel as LogLevel) ?? fileConfig.logLevel ?? defaultOptions.logLevel,
        exclude: options.exclude ? options.exclude.flatMap((p: string) => p.split(',').map(s => s.trim()).filter(Boolean)) : (fileConfig.exclude || defaultOptions.exclude),
        outputFormat: (options.outputFormat as 'text' | 'json') ?? fileConfig.outputFormat ?? defaultOptions.outputFormat,
        progress: options.progress ?? fileConfig.progress ?? defaultOptions.progress,
        diff: options.diff ?? fileConfig.diff ?? defaultOptions.diff,
        validate: options.validate ?? fileConfig.validate ?? defaultOptions.validate,
        parallel: options.parallel ?? fileConfig.parallel ?? defaultOptions.parallel,
        concurrency: Number(options.concurrency) || fileConfig.concurrency || defaultOptions.concurrency,
        declarationMap: options.declarationMap ?? fileConfig.declarationMap ?? false,
        bundle: options.bundle ?? fileConfig.bundle ?? false,
        bundleOutput: options.bundleOutput ?? fileConfig.bundleOutput ?? 'index.d.ts',
        incremental: options.incremental ?? fileConfig.incremental ?? false,
        clearCache: options.clearCache ?? false,
        plugins: fileConfig.plugins, // Plugins only from config file
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

cli
  .command('workspace', 'Generate declarations for all projects in a monorepo/workspace')
  .option('--cwd <path>', 'Workspace root directory', { default: process.cwd() })
  .option('--parallel', 'Process projects in parallel', { default: false })
  .option('--continue-on-error', 'Continue if a project fails', { default: true })
  .option('--log-level <level>', 'Log level (debug, info, warn, error, silent)', { default: 'info' })
  .example('dtsx workspace')
  .example('dtsx workspace --cwd /path/to/monorepo')
  .action(async (options: { cwd?: string, parallel?: boolean, continueOnError?: boolean, logLevel?: string }) => {
    try {
      const { generateMonorepo, generateFromPackageWorkspaces } = await import('../src/workspace')
      const { existsSync } = await import('node:fs')
      const { join, resolve } = await import('node:path')

      const rootPath = resolve(options.cwd || process.cwd())
      const rootTsConfig = join(rootPath, 'tsconfig.json')

      let result

      // Try TypeScript project references first
      if (existsSync(rootTsConfig)) {
        result = await generateMonorepo(rootPath, {
          logLevel: (options.logLevel as 'debug' | 'info' | 'warn' | 'error' | 'silent') || 'info',
          continueOnError: options.continueOnError ?? true,
        })
      }
      else {
        // Fall back to package.json workspaces
        result = await generateFromPackageWorkspaces(rootPath, {
          logLevel: (options.logLevel as 'debug' | 'info' | 'warn' | 'error' | 'silent') || 'info',
          continueOnError: options.continueOnError ?? true,
        })
      }

      if (!result.success) {
        process.exit(1)
      }
    }
    catch (error) {
      console.error('Error generating workspace declarations:', error)
      process.exit(1)
    }
  })

cli.command('version', 'Show the version of dtsx').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
