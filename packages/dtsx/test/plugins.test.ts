import { describe, expect, it } from 'bun:test'
import {
  PluginManager,
  definePlugin,
  stripInternalPlugin,
  createBannerPlugin,
  createFilterPlugin,
  type Plugin,
  type PluginContext,
  type TransformContext,
  type DeclarationContext,
} from '../src/plugins'
import type { Declaration, DtsGenerationConfig, GenerationStats } from '../src/types'

// Mock config for testing
const mockConfig: DtsGenerationConfig = {
  cwd: '/test',
  root: '/test/src',
  entrypoints: ['**/*.ts'],
  outdir: '/test/dist',
  keepComments: true,
  clean: false,
  tsconfigPath: '/test/tsconfig.json',
  verbose: false,
}

// Mock declarations for testing
const mockDeclarations: Declaration[] = [
  {
    kind: 'function',
    name: 'publicFunction',
    text: 'export function publicFunction(): void',
    isExported: true,
    leadingComments: ['/** Public function */'],
  },
  {
    kind: 'function',
    name: 'internalFunction',
    text: 'export function internalFunction(): void',
    isExported: true,
    leadingComments: ['/** @internal Internal function */'],
  },
  {
    kind: 'interface',
    name: 'PublicInterface',
    text: 'export interface PublicInterface { value: string }',
    isExported: true,
  },
  {
    kind: 'type',
    name: 'InternalType',
    text: 'export type InternalType = string',
    isExported: true,
    leadingComments: ['/** @internal */'],
  },
  {
    kind: 'import',
    name: 'fs',
    text: 'import fs from "node:fs"',
    isExported: false,
    source: 'node:fs',
  },
]

describe('PluginManager', () => {
  it('should register plugins', () => {
    const manager = new PluginManager()
    const plugin: Plugin = {
      name: 'test-plugin',
      version: '1.0.0',
    }

    manager.register(plugin)
    expect(manager.getPlugins()).toHaveLength(1)
    expect(manager.getPlugins()[0].name).toBe('test-plugin')
  })

  it('should prevent duplicate plugin registration', () => {
    const manager = new PluginManager()
    const plugin: Plugin = { name: 'test-plugin' }

    manager.register(plugin)
    expect(() => manager.register(plugin)).toThrow('already registered')
  })

  it('should unregister plugins', () => {
    const manager = new PluginManager()
    const plugin: Plugin = { name: 'test-plugin' }

    manager.register(plugin)
    expect(manager.getPlugins()).toHaveLength(1)

    const removed = manager.unregister('test-plugin')
    expect(removed).toBe(true)
    expect(manager.getPlugins()).toHaveLength(0)
  })

  it('should return false when unregistering non-existent plugin', () => {
    const manager = new PluginManager()
    expect(manager.unregister('non-existent')).toBe(false)
  })

  it('should run onStart hooks', async () => {
    const manager = new PluginManager()
    let hookCalled = false

    manager.register({
      name: 'test-plugin',
      onStart: (config) => {
        hookCalled = true
        return { ...config, verbose: true }
      },
    })

    const result = await manager.runOnStart(mockConfig)
    expect(hookCalled).toBe(true)
    expect(result.verbose).toBe(true)
  })

  it('should run onBeforeFile hooks', async () => {
    const manager = new PluginManager()

    manager.register({
      name: 'test-plugin',
      onBeforeFile: (ctx) => {
        return ctx.content.replace('const', 'let')
      },
    })

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnBeforeFile('/test.ts', 'const x = 1')
    expect(result).toBe('let x = 1')
  })

  it('should run onDeclarations hooks', async () => {
    const manager = new PluginManager()

    manager.register({
      name: 'test-plugin',
      onDeclarations: (ctx) => {
        return ctx.declarations.filter(d => d.kind !== 'import')
      },
    })

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnDeclarations('/test.ts', '', mockDeclarations)
    expect(result.some(d => d.kind === 'import')).toBe(false)
    expect(result.length).toBe(4) // Filtered out the import
  })

  it('should run onAfterFile hooks', async () => {
    const manager = new PluginManager()

    manager.register({
      name: 'test-plugin',
      onAfterFile: (ctx) => {
        return `// Modified\n${ctx.content}`
      },
    })

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnAfterFile('/test.ts', '', 'export const x = 1')
    expect(result.startsWith('// Modified')).toBe(true)
  })

  it('should run onEnd hooks', async () => {
    const manager = new PluginManager()
    let hookCalled = false

    manager.register({
      name: 'test-plugin',
      onEnd: () => {
        hookCalled = true
      },
    })

    await manager.runOnStart(mockConfig)
    await manager.runOnEnd({
      filesProcessed: 1,
      filesGenerated: 1,
      filesFailed: 0,
      filesValidated: 0,
      validationErrors: 0,
      declarationsFound: 5,
      importsProcessed: 1,
      exportsProcessed: 4,
      durationMs: 100,
      errors: [],
    })

    expect(hookCalled).toBe(true)
  })

  it('should run onError hooks', async () => {
    const manager = new PluginManager()
    let capturedError: Error | null = null

    manager.register({
      name: 'test-plugin',
      onError: (error) => {
        capturedError = error
      },
    })

    await manager.runOnStart(mockConfig)
    await manager.runOnError(new Error('Test error'), '/test.ts', '')

    expect(capturedError).not.toBeNull()
    expect(capturedError!.message).toBe('Test error')
  })

  it('should chain multiple plugins', async () => {
    const manager = new PluginManager()
    const order: string[] = []

    manager.register({
      name: 'plugin-1',
      onBeforeFile: (ctx) => {
        order.push('plugin-1')
        return ctx.content + '-1'
      },
    })

    manager.register({
      name: 'plugin-2',
      onBeforeFile: (ctx) => {
        order.push('plugin-2')
        return ctx.content + '-2'
      },
    })

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnBeforeFile('/test.ts', 'start')

    expect(order).toEqual(['plugin-1', 'plugin-2'])
    expect(result).toBe('start-1-2')
  })
})

describe('definePlugin', () => {
  it('should return the plugin as-is', () => {
    const plugin: Plugin = {
      name: 'test',
      version: '1.0.0',
      description: 'Test plugin',
    }

    expect(definePlugin(plugin)).toBe(plugin)
  })
})

describe('stripInternalPlugin', () => {
  it('should remove declarations marked @internal', async () => {
    const manager = new PluginManager()
    manager.register(stripInternalPlugin)

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnDeclarations('/test.ts', '', mockDeclarations)

    expect(result.some(d => d.name === 'publicFunction')).toBe(true)
    expect(result.some(d => d.name === 'internalFunction')).toBe(false)
    expect(result.some(d => d.name === 'PublicInterface')).toBe(true)
    expect(result.some(d => d.name === 'InternalType')).toBe(false)
  })

  it('should keep declarations without @internal', async () => {
    const manager = new PluginManager()
    manager.register(stripInternalPlugin)

    const declarations: Declaration[] = [
      {
        kind: 'function',
        name: 'foo',
        text: 'export function foo(): void',
        isExported: true,
        leadingComments: ['/** A normal function */'],
      },
    ]

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnDeclarations('/test.ts', '', declarations)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('foo')
  })
})

describe('createBannerPlugin', () => {
  it('should add banner comment to output', async () => {
    const manager = new PluginManager()
    manager.register(createBannerPlugin('Generated by test'))

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnAfterFile('/test.ts', '', 'export const x = 1')

    expect(result).toContain('Generated by test')
    expect(result).toContain('export const x = 1')
    expect(result.startsWith('/**')).toBe(true)
  })

  it('should handle multi-line banners', async () => {
    const manager = new PluginManager()
    manager.register(createBannerPlugin('Line 1\nLine 2'))

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnAfterFile('/test.ts', '', 'export const x = 1')

    expect(result).toContain('Line 1')
    expect(result).toContain('Line 2')
  })
})

describe('createFilterPlugin', () => {
  it('should filter declarations by name', async () => {
    const manager = new PluginManager()
    manager.register(createFilterPlugin(name => name.startsWith('public') || name.startsWith('Public')))

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnDeclarations('/test.ts', '', mockDeclarations)

    expect(result.some(d => d.name === 'publicFunction')).toBe(true)
    expect(result.some(d => d.name === 'PublicInterface')).toBe(true)
    expect(result.some(d => d.name === 'internalFunction')).toBe(false)
    expect(result.some(d => d.name === 'InternalType')).toBe(false)
  })

  it('should always keep imports', async () => {
    const manager = new PluginManager()
    manager.register(createFilterPlugin(name => name === 'publicFunction'))

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnDeclarations('/test.ts', '', mockDeclarations)

    // Import should still be there even though it doesn't match the filter
    expect(result.some(d => d.kind === 'import')).toBe(true)
    expect(result.some(d => d.name === 'publicFunction')).toBe(true)
  })
})

describe('Plugin async support', () => {
  it('should support async onStart', async () => {
    const manager = new PluginManager()

    manager.register({
      name: 'async-plugin',
      onStart: async (config) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { ...config, verbose: true }
      },
    })

    const result = await manager.runOnStart(mockConfig)
    expect(result.verbose).toBe(true)
  })

  it('should support async onDeclarations', async () => {
    const manager = new PluginManager()

    manager.register({
      name: 'async-plugin',
      onDeclarations: async (ctx) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return ctx.declarations.filter(d => d.isExported)
      },
    })

    await manager.runOnStart(mockConfig)
    const result = await manager.runOnDeclarations('/test.ts', '', mockDeclarations)
    expect(result.every(d => d.isExported || d.kind === 'import')).toBe(true)
  })
})

describe('Plugin context', () => {
  it('should provide correct context to hooks', async () => {
    const manager = new PluginManager()
    let capturedCtx: TransformContext | null = null

    manager.register({
      name: 'context-plugin',
      onBeforeFile: (ctx) => {
        capturedCtx = ctx
        return undefined
      },
    })

    await manager.runOnStart(mockConfig)
    await manager.runOnBeforeFile('/test/file.ts', 'const x = 1')

    expect(capturedCtx).not.toBeNull()
    expect(capturedCtx!.filePath).toBe('/test/file.ts')
    expect(capturedCtx!.sourceCode).toBe('const x = 1')
    expect(capturedCtx!.content).toBe('const x = 1')
    expect(capturedCtx!.config).toBeDefined()
    expect(capturedCtx!.log).toBeDefined()
    expect(capturedCtx!.log.debug).toBeInstanceOf(Function)
    expect(capturedCtx!.log.info).toBeInstanceOf(Function)
    expect(capturedCtx!.log.warn).toBeInstanceOf(Function)
    expect(capturedCtx!.log.error).toBeInstanceOf(Function)
  })
})
