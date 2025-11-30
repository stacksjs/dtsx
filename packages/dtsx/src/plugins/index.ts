/**
 * Build tool plugins for dtsx
 * Re-exports all available build tool integrations
 */

// Vite
export { dts as viteDts, dts as vite, type VitePluginOptions } from './vite'

// Bun
export { dts as bunDts, dts as bun, type BunPluginOptions } from './bun'

// esbuild
export { dtsx as esbuildDts, dtsx as esbuild, dts as esbuildPlugin, type EsbuildPluginOptions } from './esbuild'

// tsup
export { dtsxPlugin as tsupDts, dtsxPlugin as tsup, dts as tsupPlugin, type TsupPluginOptions } from './tsup'

// webpack
export { DtsxWebpackPlugin, dtsxWebpack as webpackDts, dts as webpackPlugin, type WebpackPluginOptions } from './webpack'
