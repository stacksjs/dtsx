/**
 * @stacksjs/dtsx - A modern, fast .d.ts generation tool
 *
 * This module exports the full API. For minimal bundle size when only
 * using the core generator, import directly from './generator'.
 *
 * Core exports (most commonly used):
 * - generate, watch, processFile, processSource from './generator'
 * - extractDeclarations, extractDeclarationsAsync from './extractor'
 * - processDeclarations from './processor'
 * - DtsGenerationConfig, Declaration types from './types'
 *
 * Optional/Advanced exports are available but may increase bundle size:
 * - LSP support: './lsp'
 * - Type checking: './checker'
 * - Circular dependency detection: './circular'
 * - Custom transformers: './transformers'
 * - Worker pool: './worker'
 */

// Common utilities
export * from './branded-types'
export * from './bundler'
export * from './cache'
export * from './checker'
// Advanced features - larger bundle impact
export * from './circular'
export * from './compat'
export * from './config'

export * from './diff'
export * from './docs'
export * from './errors'
export * from './extractor'
export * from './formats'
export * from './formatter'
// Core API - essential for dts generation
export * from './generator'
export * from './import-sorter'

export * from './incremental'
export * from './logger'
export * from './lsp'
export * from './memory'
export * from './merger'
export * from './optimizer'
export * from './output-normalizer'
export * from './parallel-processor'
export * from './parser'
export * from './plugins'
export * from './processor'
export * from './profiling'
export * from './security'
export * from './sourcemap'
export * from './tracking'
export * from './transformers'
export * from './tree-shaker'
export * from './type-mappings'
export * from './types'
export * from './utils'
export * from './watcher'
export * from './worker'
export * from './workspace'
