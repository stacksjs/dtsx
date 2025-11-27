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
  .option('--indent-style <style>', 'Indentation style: spaces or tabs', { default: 'spaces' })
  .option('--indent-size <size>', 'Number of spaces for indentation', { default: 2 })
  .option('--prettier', 'Use Prettier for output formatting if available', { default: false })
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
        indentStyle: (options.indentStyle as 'spaces' | 'tabs') ?? fileConfig.indentStyle ?? 'spaces',
        indentSize: Number(options.indentSize) || fileConfig.indentSize || 2,
        prettier: options.prettier ?? fileConfig.prettier ?? false,
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
  .command('optimize', 'Optimize declaration files')
  .option('--files <patterns>', 'Glob patterns for .d.ts files to optimize', {
    default: '**/*.d.ts',
    type: [String],
  })
  .option('--outdir <path>', 'Output directory (defaults to in-place)', { default: '' })
  .option('--remove-unused-imports', 'Remove unused type imports', { default: true })
  .option('--deduplicate', 'Remove duplicate declarations', { default: true })
  .option('--merge-interfaces', 'Merge interface declarations with same name', { default: true })
  .option('--inline-types', 'Inline simple type aliases', { default: false })
  .option('--remove-empty', 'Remove empty interfaces', { default: true })
  .option('--sort', 'Sort declarations alphabetically', { default: false })
  .option('--sort-imports', 'Sort imports', { default: true })
  .option('--minify', 'Minify output (remove whitespace)', { default: false })
  .option('--remove-comments', 'Remove comments', { default: false })
  .example('dtsx optimize --files "dist/**/*.d.ts"')
  .example('dtsx optimize --minify --remove-comments')
  .action(async (options: {
    files?: string[]
    outdir?: string
    removeUnusedImports?: boolean
    deduplicate?: boolean
    mergeInterfaces?: boolean
    inlineTypes?: boolean
    removeEmpty?: boolean
    sort?: boolean
    sortImports?: boolean
    minify?: boolean
    removeComments?: boolean
  }) => {
    try {
      const { optimizeFile } = await import('../src/optimizer')
      const { Glob } = await import('bun')
      const { resolve, join, relative, dirname, basename } = await import('node:path')
      const { mkdirSync, copyFileSync, existsSync } = await import('node:fs')

      const cwd = process.cwd()
      const patterns = options.files || ['**/*.d.ts']

      // Find all .d.ts files
      const files: string[] = []
      for (const pattern of patterns) {
        const glob = new Glob(pattern)
        for await (const file of glob.scan({
          cwd,
          absolute: true,
          onlyFiles: true,
        })) {
          if (file.endsWith('.d.ts') && !file.includes('node_modules')) {
            files.push(file)
          }
        }
      }

      if (files.length === 0) {
        console.error('No .d.ts files found')
        process.exit(1)
      }

      console.log(`Optimizing ${files.length} declaration files...`)

      let totalSavings = 0
      let totalOriginal = 0

      for (const file of files) {
        // If outdir specified, copy file there first
        let targetFile = file
        if (options.outdir) {
          const relPath = relative(cwd, file)
          targetFile = join(resolve(options.outdir), relPath)
          const targetDir = dirname(targetFile)
          if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true })
          }
          copyFileSync(file, targetFile)
        }

        const result = await optimizeFile(targetFile, {
          removeUnusedImports: options.removeUnusedImports ?? true,
          deduplicateDeclarations: options.deduplicate ?? true,
          mergeInterfaces: options.mergeInterfaces ?? true,
          inlineSimpleTypes: options.inlineTypes ?? false,
          removeEmptyInterfaces: options.removeEmpty ?? true,
          sortDeclarations: options.sort ?? false,
          sortImports: options.sortImports ?? true,
          minify: options.minify ?? false,
          removeComments: options.removeComments ?? false,
        })

        totalOriginal += result.originalSize
        totalSavings += result.savings

        const relPath = relative(cwd, targetFile)
        console.log(`  ${relPath}: ${result.originalSize}B -> ${result.optimizedSize}B (-${result.savingsPercent}%)`)
      }

      const totalPercent = totalOriginal > 0 ? Math.round((totalSavings / totalOriginal) * 100) : 0
      console.log(`\nTotal: ${totalOriginal}B -> ${totalOriginal - totalSavings}B (-${totalPercent}%)`)
    }
    catch (error) {
      console.error('Error optimizing files:', error)
      process.exit(1)
    }
  })

cli
  .command('docs', 'Generate API documentation from source files')
  .option('--root <path>', 'Root directory to scan for source files', { default: './src' })
  .option('--outdir <path>', 'Output directory for documentation', { default: './docs' })
  .option('--format <format>', 'Output format: markdown or html', { default: 'markdown' })
  .option('--title <title>', 'Documentation title', { default: 'API Documentation' })
  .option('--include-private', 'Include private members (prefixed with _)', { default: false })
  .option('--include-internal', 'Include internal members (@internal)', { default: false })
  .option('--group-by-category', 'Group entries by @category tag', { default: false })
  .option('--source-url <url>', 'Base URL for source links')
  .example('dtsx docs')
  .example('dtsx docs --format html --outdir ./api-docs')
  .example('dtsx docs --group-by-category --title "My API"')
  .action(async (options: {
    root?: string
    outdir?: string
    format?: string
    title?: string
    includePrivate?: boolean
    includeInternal?: boolean
    groupByCategory?: boolean
    sourceUrl?: string
  }) => {
    try {
      const { generateDocs } = await import('../src/docs')
      const { Glob } = await import('bun')
      const { resolve } = await import('node:path')

      const rootPath = resolve(options.root || './src')

      // Find all TypeScript files
      const glob = new Glob('**/*.ts')
      const files: string[] = []

      for await (const file of glob.scan({
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      })) {
        if (!file.endsWith('.d.ts') && !file.includes('node_modules')) {
          files.push(file)
        }
      }

      if (files.length === 0) {
        console.error('No TypeScript files found')
        process.exit(1)
      }

      console.log(`Found ${files.length} source files`)

      await generateDocs(files, {
        format: (options.format as 'markdown' | 'html') || 'markdown',
        outdir: resolve(options.outdir || './docs'),
        title: options.title || 'API Documentation',
        includePrivate: options.includePrivate ?? false,
        includeInternal: options.includeInternal ?? false,
        groupByCategory: options.groupByCategory ?? false,
        includeSourceLinks: !!options.sourceUrl,
        sourceBaseUrl: options.sourceUrl,
      })
    }
    catch (error) {
      console.error('Error generating documentation:', error)
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

cli
  .command('lsp', 'Start the Language Server Protocol server for IDE integration')
  .example('dtsx lsp')
  .action(async () => {
    const { startLSPServer } = await import('../src/lsp')
    startLSPServer()
  })

cli
  .command('check', 'Type check TypeScript files or validate generated declarations')
  .option('--files <patterns>', 'Glob patterns for files to check', {
    default: '**/*.ts',
    type: [String],
  })
  .option('--declarations-only', 'Only check .d.ts files', { default: false })
  .option('--tsconfig <path>', 'Path to tsconfig.json', { default: 'tsconfig.json' })
  .option('--strict', 'Enable strict type checking', { default: false })
  .option('--skip-lib-check', 'Skip checking library definitions', { default: true })
  .option('--warnings-as-errors', 'Treat warnings as errors', { default: false })
  .option('--max-errors <number>', 'Maximum errors before stopping', { default: 0 })
  .option('--isolated-declarations', 'Check for isolated declarations compatibility', { default: false })
  .option('--format <format>', 'Output format: text or json', { default: 'text' })
  .example('dtsx check')
  .example('dtsx check --files "src/**/*.ts" --strict')
  .example('dtsx check --declarations-only --files "dist/**/*.d.ts"')
  .example('dtsx check --isolated-declarations')
  .action(async (options: {
    files?: string[]
    declarationsOnly?: boolean
    tsconfig?: string
    strict?: boolean
    skipLibCheck?: boolean
    warningsAsErrors?: boolean
    maxErrors?: number
    isolatedDeclarations?: boolean
    format?: string
  }) => {
    try {
      const { typeCheck, checkIsolatedDeclarations, formatTypeCheckResults } = await import('../src/checker')
      const { Glob } = await import('bun')
      const { resolve, relative } = await import('node:path')

      const cwd = process.cwd()
      const patterns = options.files || ['**/*.ts']

      // Find all files matching patterns
      const files: string[] = []
      for (const pattern of patterns) {
        const glob = new Glob(pattern)
        for await (const file of glob.scan({
          cwd,
          absolute: true,
          onlyFiles: true,
        })) {
          if (!file.includes('node_modules')) {
            if (options.declarationsOnly) {
              if (file.endsWith('.d.ts')) {
                files.push(file)
              }
            }
            else {
              files.push(file)
            }
          }
        }
      }

      if (files.length === 0) {
        console.error('No files found to check')
        process.exit(1)
      }

      // Handle isolated declarations mode
      if (options.isolatedDeclarations) {
        console.log(`Checking ${files.length} files for isolated declarations compatibility...`)

        const results = await checkIsolatedDeclarations(
          files,
          options.tsconfig ? resolve(options.tsconfig) : undefined,
        )

        let totalIssues = 0
        const output: { file: string, compatible: boolean, issues: any[] }[] = []

        for (const [file, result] of results) {
          const relPath = relative(cwd, file)

          if (!result.compatible) {
            totalIssues += result.issues.length

            if (options.format === 'json') {
              output.push({
                file: relPath,
                compatible: false,
                issues: result.issues,
              })
            }
            else {
              console.log(`\n✗ ${relPath}`)
              for (const issue of result.issues) {
                console.log(`  ${issue.line}:${issue.column} - ${issue.message}`)
                if (issue.missingAnnotation) {
                  console.log(`    Missing: ${issue.missingAnnotation} type annotation`)
                }
              }
            }
          }
          else if (options.format === 'json') {
            output.push({
              file: relPath,
              compatible: true,
              issues: [],
            })
          }
        }

        if (options.format === 'json') {
          console.log(JSON.stringify(output, null, 2))
        }
        else {
          console.log(`\n${files.length} files checked, ${totalIssues} issues found`)
        }

        process.exit(totalIssues > 0 ? 1 : 0)
      }

      // Regular type checking
      console.log(`Type checking ${files.length} files...`)

      const result = await typeCheck(files, {
        tsconfigPath: options.tsconfig ? resolve(options.tsconfig) : undefined,
        strict: options.strict ?? false,
        declarationsOnly: options.declarationsOnly ?? false,
        skipLibCheck: options.skipLibCheck ?? true,
        warningsAsErrors: options.warningsAsErrors ?? false,
        maxErrors: options.maxErrors || undefined,
      })

      if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2))
      }
      else {
        console.log(formatTypeCheckResults(result))
      }

      process.exit(result.success ? 0 : 1)
    }
    catch (error) {
      console.error('Error during type checking:', error)
      process.exit(1)
    }
  })

cli
  .command('convert', 'Convert TypeScript types to different schema formats')
  .option('--files <patterns>', 'Glob patterns for TypeScript files', {
    default: '**/*.ts',
    type: [String],
  })
  .option('--format <format>', 'Output format: json-schema, zod, valibot, io-ts, yup, arktype', { default: 'json-schema' })
  .option('--outdir <path>', 'Output directory for converted files', { default: './schemas' })
  .option('--include-descriptions', 'Include JSDoc descriptions in output', { default: true })
  .option('--all-optional', 'Make all properties optional', { default: false })
  .option('--use-infer', 'Include inferred types (for Zod, Valibot, etc.)', { default: true })
  .option('--json-schema-draft <version>', 'JSON Schema draft version: 2020-12, 2019-09, draft-07', { default: '2020-12' })
  .example('dtsx convert --format zod')
  .example('dtsx convert --format json-schema --files "src/types/**/*.ts"')
  .example('dtsx convert --format valibot --outdir ./validation')
  .action(async (options: {
    files?: string[]
    format?: string
    outdir?: string
    includeDescriptions?: boolean
    allOptional?: boolean
    useInfer?: boolean
    jsonSchemaDraft?: string
  }) => {
    try {
      const formats = await import('../src/formats')
      const { extractDeclarations } = await import('../src/extractor')
      const { Glob } = await import('bun')
      const { resolve, relative, join, dirname, basename } = await import('node:path')
      const { mkdirSync, existsSync, readFileSync, writeFileSync } = await import('node:fs')

      const cwd = process.cwd()
      const patterns = options.files || ['**/*.ts']
      const format = (options.format || 'json-schema') as formats.OutputFormat
      const outdir = resolve(options.outdir || './schemas')

      // Find all TypeScript files
      const files: string[] = []
      for (const pattern of patterns) {
        const glob = new Glob(pattern)
        for await (const file of glob.scan({
          cwd,
          absolute: true,
          onlyFiles: true,
        })) {
          if (!file.endsWith('.d.ts') && !file.includes('node_modules')) {
            files.push(file)
          }
        }
      }

      if (files.length === 0) {
        console.error('No TypeScript files found')
        process.exit(1)
      }

      console.log(`Converting ${files.length} files to ${format} format...`)

      // Ensure output directory exists
      if (!existsSync(outdir)) {
        mkdirSync(outdir, { recursive: true })
      }

      let totalDeclarations = 0
      let filesConverted = 0

      for (const file of files) {
        const sourceCode = readFileSync(file, 'utf-8')
        const declarations = extractDeclarations(sourceCode, file)

        // Filter to only interfaces and types
        const typeDeclarations = declarations.filter(
          d => d.kind === 'interface' || d.kind === 'type',
        )

        if (typeDeclarations.length === 0) continue

        const output = formats.convertToFormat(typeDeclarations, {
          format,
          includeDescriptions: options.includeDescriptions ?? true,
          allOptional: options.allOptional ?? false,
          useInfer: options.useInfer ?? true,
          jsonSchemaDraft: (options.jsonSchemaDraft as '2020-12' | '2019-09' | 'draft-07') || '2020-12',
        })

        // Determine output filename
        const relPath = relative(cwd, file)
        const baseName = basename(file, '.ts')
        const ext = formats.getFormatExtension(format)
        const outputFile = join(outdir, dirname(relPath), `${baseName}${ext}`)

        // Ensure output subdirectory exists
        const outputDir = dirname(outputFile)
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true })
        }

        writeFileSync(outputFile, output)
        totalDeclarations += typeDeclarations.length
        filesConverted++

        console.log(`  ${relative(cwd, outputFile)} (${typeDeclarations.length} types)`)
      }

      console.log(`\nConverted ${totalDeclarations} declarations from ${filesConverted} files`)
    }
    catch (error) {
      console.error('Error converting files:', error)
      process.exit(1)
    }
  })

cli
  .command('circular', 'Detect circular dependencies in TypeScript files')
  .option('--files <patterns>', 'Glob patterns for files to check', {
    default: '**/*.ts',
    type: [String],
  })
  .option('--root <path>', 'Root directory for resolution', { default: '.' })
  .option('--ignore <patterns>', 'Glob patterns to ignore (comma-separated)', {
    default: '',
    type: [String],
  })
  .option('--types-only', 'Only report type-level cycles', { default: false })
  .option('--max-depth <number>', 'Maximum depth for cycle detection', { default: 100 })
  .option('--include-node-modules', 'Include node_modules in analysis', { default: false })
  .option('--format <format>', 'Output format: text, json, dot', { default: 'text' })
  .option('--summary', 'Show graph summary statistics', { default: false })
  .example('dtsx circular')
  .example('dtsx circular --files "src/**/*.ts"')
  .example('dtsx circular --ignore "**/*.test.ts,**/__tests__/**"')
  .example('dtsx circular --format dot > deps.dot')
  .example('dtsx circular --summary')
  .action(async (options: {
    files?: string[]
    root?: string
    ignore?: string[]
    typesOnly?: boolean
    maxDepth?: number
    includeNodeModules?: boolean
    format?: string
    summary?: boolean
  }) => {
    try {
      const {
        analyzeCircularDependencies,
        formatCircularAnalysis,
        getGraphSummary,
        exportGraphAsDot,
        exportGraphAsJson,
      } = await import('../src/circular')
      const { Glob } = await import('bun')
      const { resolve, relative } = await import('node:path')

      const cwd = process.cwd()
      const rootDir = resolve(options.root || '.')
      const patterns = options.files || ['**/*.ts']

      // Find all files matching patterns
      const files: string[] = []
      for (const pattern of patterns) {
        const glob = new Glob(pattern)
        for await (const file of glob.scan({
          cwd: rootDir,
          absolute: true,
          onlyFiles: true,
        })) {
          if (!file.endsWith('.d.ts')) {
            if (!options.includeNodeModules && file.includes('node_modules')) {
              continue
            }
            files.push(file)
          }
        }
      }

      if (files.length === 0) {
        console.error('No TypeScript files found')
        process.exit(1)
      }

      console.log(`Analyzing ${files.length} files for circular dependencies...`)

      const result = await analyzeCircularDependencies(files, {
        rootDir,
        ignore: options.ignore?.filter(Boolean),
        typesOnly: options.typesOnly ?? false,
        maxDepth: options.maxDepth ?? 100,
        includeNodeModules: options.includeNodeModules ?? false,
      })

      // Handle different output formats
      if (options.format === 'json') {
        console.log(exportGraphAsJson(result.graph, rootDir))
      }
      else if (options.format === 'dot') {
        console.log(exportGraphAsDot(result.graph, rootDir))
      }
      else {
        // Text format
        console.log(formatCircularAnalysis(result, rootDir))

        // Show summary if requested
        if (options.summary) {
          const summary = getGraphSummary(result.graph)
          console.log('\n--- Dependency Graph Summary ---')
          console.log(`Total files: ${summary.totalFiles}`)
          console.log(`Total dependencies: ${summary.totalDependencies}`)
          console.log(`Average dependencies per file: ${summary.avgDependencies.toFixed(2)}`)
          if (summary.maxDependencies.count > 0) {
            console.log(`Most dependencies: ${relative(rootDir, summary.maxDependencies.file)} (${summary.maxDependencies.count})`)
          }
          if (summary.mostDepended.count > 0) {
            console.log(`Most depended on: ${relative(rootDir, summary.mostDepended.file)} (${summary.mostDepended.count} dependents)`)
          }
          if (summary.isolatedFiles.length > 0) {
            console.log(`Isolated files (no dependencies): ${summary.isolatedFiles.length}`)
          }
        }
      }

      // Exit with error code if cycles found
      process.exit(result.hasCircular ? 1 : 0)
    }
    catch (error) {
      console.error('Error analyzing dependencies:', error)
      process.exit(1)
    }
  })

cli.command('version', 'Show the version of dtsx').action(() => {
  console.log(version)
})

cli.version(version)
cli.help()
cli.parse()
