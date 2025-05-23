#!/usr/bin/env bun

import { parseArgs } from 'util'
import { generate } from './generator'
import type { DtsGenerationOption } from './types'
import { config as defaultConfig } from './config'
import { resolve } from 'node:path'

// Parse command line arguments
const { values, positionals } = parseArgs({
  args: Bun.argv,
  options: {
    help: {
      type: 'boolean',
      short: 'h',
    },
    version: {
      type: 'boolean',
      short: 'v',
    },
    root: {
      type: 'string',
      short: 'r',
    },
    outdir: {
      type: 'string',
      short: 'o',
    },
    clean: {
      type: 'boolean',
      short: 'c',
    },
    'keep-comments': {
      type: 'boolean',
    },
    tsconfig: {
      type: 'string',
    },
    verbose: {
      type: 'boolean',
    },
    'output-structure': {
      type: 'string',
    },
  },
  allowPositionals: true,
})

// Show help
if (values.help) {
  console.log(`
dtsx - A modern, fast .d.ts generation tool

Usage:
  dtsx [options] [entrypoints...]

Options:
  -h, --help              Show this help message
  -v, --version           Show version
  -r, --root <dir>        Root directory (default: ./src)
  -o, --outdir <dir>      Output directory (default: ./dist)
  -c, --clean             Clean output directory before generation
  --keep-comments         Keep comments in output (default: true)
  --tsconfig <path>       Path to tsconfig.json
  --verbose               Verbose output
  --output-structure      Output structure: 'mirror' or 'flat' (default: mirror)

Examples:
  dtsx                    Generate .d.ts files for all .ts files in src/
  dtsx -r lib -o types    Generate from lib/ to types/
  dtsx src/index.ts       Generate only for specific file
`)
  process.exit(0)
}

// Show version
if (values.version) {
  const pkg = await import('../package.json')
  console.log(pkg.version)
  process.exit(0)
}

// Build configuration
const options: DtsGenerationOption = {
  root: values.root || defaultConfig.root,
  outdir: values.outdir || defaultConfig.outdir,
  clean: values.clean ?? defaultConfig.clean,
  keepComments: values['keep-comments'] ?? defaultConfig.keepComments,
  tsconfigPath: values.tsconfig || defaultConfig.tsconfigPath,
  verbose: values.verbose ?? defaultConfig.verbose,
  outputStructure: (values['output-structure'] as 'mirror' | 'flat') || defaultConfig.outputStructure,
}

// Handle entrypoints
if (positionals.length > 2) { // First two are bun and script path
  const entrypoints = positionals.slice(2)
  options.entrypoints = entrypoints.map(e => {
    // If it's a file path, convert to glob pattern relative to root
    if (e.endsWith('.ts')) {
      const relativePath = resolve(process.cwd(), e)
      return relativePath
    }
    return e
  })
} else {
  options.entrypoints = defaultConfig.entrypoints
}

// Run generation
try {
  await generate(options)
} catch (error) {
  console.error('Error generating .d.ts files:', error)
  process.exit(1)
}