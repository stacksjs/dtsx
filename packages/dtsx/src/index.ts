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

// Core API - essential for dts generation
export * from './generator'
export * from './extractor'
export * from './processor'
export * from './types'
export * from './config'
export * from './errors'
export * from './plugins'

// Common utilities
export * from './bundler'
export * from './cache'
export * from './formatter'
export * from './logger'
export * from './parser'
export * from './utils'

// Advanced features - larger bundle impact
export * from './circular'
export * from './compat'
export * from './incremental'
export * from './checker'
export * from './diff'
export * from './docs'
export * from './formats'
export * from './import-sorter'
export * from './memory'
export * from './merger'
export * from './lsp'
export * from './optimizer'
export * from './sourcemap'
export * from './transformers'
export * from './tree-shaker'
export * from './watcher'
export * from './worker'
export * from './workspace'
