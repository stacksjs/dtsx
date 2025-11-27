import type { Declaration, DtsGenerationConfig, GenerationStats } from './types'

/**
 * Context passed to plugin hooks
 */
export interface PluginContext {
  /** Current file being processed */
  filePath: string
  /** Original source code */
  sourceCode: string
  /** Current configuration */
  config: DtsGenerationConfig
  /** Logger for plugin output */
  log: {
    debug: (message: string) => void
    info: (message: string) => void
    warn: (message: string) => void
    error: (message: string) => void
  }
}

/**
 * Transform context with mutable content
 */
export interface TransformContext extends PluginContext {
  /** Content that can be modified */
  content: string
}

/**
 * Declaration context for declaration hooks
 */
export interface DeclarationContext extends PluginContext {
  /** Parsed declarations */
  declarations: Declaration[]
}

/**
 * Plugin hook definitions
 */
export interface PluginHooks {
  /**
   * Called before any processing starts
   * Use for setup, validation, or modifying config
   */
  onStart?: (config: DtsGenerationConfig) => DtsGenerationConfig | void | Promise<DtsGenerationConfig | void>

  /**
   * Called before a file is processed
   * Can modify the source code before parsing
   */
  onBeforeFile?: (ctx: TransformContext) => string | void | Promise<string | void>

  /**
   * Called after declarations are extracted but before output is generated
   * Can modify, add, or remove declarations
   */
  onDeclarations?: (ctx: DeclarationContext) => Declaration[] | void | Promise<Declaration[] | void>

  /**
   * Called after .d.ts content is generated but before writing
   * Can modify the final output
   */
  onAfterFile?: (ctx: TransformContext) => string | void | Promise<string | void>

  /**
   * Called after all files are processed
   * Use for cleanup, reporting, or post-processing
   */
  onEnd?: (stats: GenerationStats) => void | Promise<void>

  /**
   * Called when an error occurs during processing
   * Can handle or transform errors
   */
  onError?: (error: Error, ctx: PluginContext) => void | Promise<void>
}

/**
 * Plugin definition
 */
export interface Plugin extends PluginHooks {
  /** Unique plugin name */
  name: string
  /** Plugin version */
  version?: string
  /** Plugin description */
  description?: string
}

/**
 * Plugin manager for handling multiple plugins
 */
export class PluginManager {
  private plugins: Plugin[] = []
  private config: DtsGenerationConfig | null = null

  /**
   * Register a plugin
   */
  register(plugin: Plugin): void {
    if (this.plugins.some(p => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`)
    }
    this.plugins.push(plugin)
  }

  /**
   * Unregister a plugin by name
   */
  unregister(name: string): boolean {
    const index = this.plugins.findIndex(p => p.name === name)
    if (index >= 0) {
      this.plugins.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): readonly Plugin[] {
    return this.plugins
  }

  /**
   * Create a logger for plugin context
   */
  private createLogger(pluginName: string) {
    return {
      debug: (msg: string) => console.debug(`[${pluginName}] ${msg}`),
      info: (msg: string) => console.info(`[${pluginName}] ${msg}`),
      warn: (msg: string) => console.warn(`[${pluginName}] ${msg}`),
      error: (msg: string) => console.error(`[${pluginName}] ${msg}`),
    }
  }

  /**
   * Run onStart hooks
   */
  async runOnStart(config: DtsGenerationConfig): Promise<DtsGenerationConfig> {
    let currentConfig = config
    for (const plugin of this.plugins) {
      if (plugin.onStart) {
        const result = await plugin.onStart(currentConfig)
        if (result) {
          currentConfig = result
        }
      }
    }
    this.config = currentConfig
    return currentConfig
  }

  /**
   * Run onBeforeFile hooks
   */
  async runOnBeforeFile(filePath: string, sourceCode: string): Promise<string> {
    let content = sourceCode
    for (const plugin of this.plugins) {
      if (plugin.onBeforeFile) {
        const ctx: TransformContext = {
          filePath,
          sourceCode,
          content,
          config: this.config!,
          log: this.createLogger(plugin.name),
        }
        const result = await plugin.onBeforeFile(ctx)
        if (typeof result === 'string') {
          content = result
        }
      }
    }
    return content
  }

  /**
   * Run onDeclarations hooks
   */
  async runOnDeclarations(filePath: string, sourceCode: string, declarations: Declaration[]): Promise<Declaration[]> {
    let currentDeclarations = declarations
    for (const plugin of this.plugins) {
      if (plugin.onDeclarations) {
        const ctx: DeclarationContext = {
          filePath,
          sourceCode,
          declarations: currentDeclarations,
          config: this.config!,
          log: this.createLogger(plugin.name),
        }
        const result = await plugin.onDeclarations(ctx)
        if (result) {
          currentDeclarations = result
        }
      }
    }
    return currentDeclarations
  }

  /**
   * Run onAfterFile hooks
   */
  async runOnAfterFile(filePath: string, sourceCode: string, dtsContent: string): Promise<string> {
    let content = dtsContent
    for (const plugin of this.plugins) {
      if (plugin.onAfterFile) {
        const ctx: TransformContext = {
          filePath,
          sourceCode,
          content,
          config: this.config!,
          log: this.createLogger(plugin.name),
        }
        const result = await plugin.onAfterFile(ctx)
        if (typeof result === 'string') {
          content = result
        }
      }
    }
    return content
  }

  /**
   * Run onEnd hooks
   */
  async runOnEnd(stats: GenerationStats): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onEnd) {
        await plugin.onEnd(stats)
      }
    }
  }

  /**
   * Run onError hooks
   */
  async runOnError(error: Error, filePath: string, sourceCode: string): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onError) {
        const ctx: PluginContext = {
          filePath,
          sourceCode,
          config: this.config!,
          log: this.createLogger(plugin.name),
        }
        await plugin.onError(error, ctx)
      }
    }
  }
}

/**
 * Global plugin manager instance
 */
export const pluginManager: PluginManager = new PluginManager()

/**
 * Helper to create a plugin
 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin
}

/**
 * Built-in plugin: Strip internal declarations
 * Removes declarations marked with @internal in JSDoc
 */
export const stripInternalPlugin: Plugin = definePlugin({
  name: 'strip-internal',
  version: '1.0.0',
  description: 'Removes declarations marked with @internal',
  onDeclarations: (ctx) => {
    return ctx.declarations.filter((decl) => {
      if (decl.leadingComments) {
        const hasInternal = decl.leadingComments.some(
          comment => comment.includes('@internal'),
        )
        if (hasInternal) {
          ctx.log.debug(`Stripping internal declaration: ${decl.name}`)
          return false
        }
      }
      return true
    })
  },
})

/**
 * Built-in plugin: Add banner comment
 * Adds a banner comment to the top of generated files
 */
export function createBannerPlugin(banner: string): Plugin {
  return definePlugin({
    name: 'banner',
    version: '1.0.0',
    description: 'Adds a banner comment to generated files',
    onAfterFile: (ctx) => {
      const bannerComment = `/**\n * ${banner.split('\n').join('\n * ')}\n */\n\n`
      return bannerComment + ctx.content
    },
  })
}

/**
 * Built-in plugin: Filter exports
 * Only include declarations matching the filter
 */
export function createFilterPlugin(filter: (name: string) => boolean): Plugin {
  return definePlugin({
    name: 'filter',
    version: '1.0.0',
    description: 'Filters declarations by name',
    onDeclarations: (ctx) => {
      return ctx.declarations.filter((decl) => {
        if (decl.kind === 'import')
          return true // Keep imports
        return filter(decl.name)
      })
    },
  })
}
