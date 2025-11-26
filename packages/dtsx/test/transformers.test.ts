import { describe, expect, it } from 'bun:test'
import {
  createDeclaration,
  cloneDeclaration,
  walkDeclarations,
  findDeclarations,
  mapDeclarations,
  composeTransformers,
  filterByKind,
  filterByPredicate,
  createTransformerPlugin,
  createRenameTransformer,
  createPrefixTransformer,
  createSuffixTransformer,
  createRemoveTransformer,
  createJSDocTransformer,
  createTypeTransformer,
  createModifierTransformer,
  readonlyTransformer,
  requiredTransformer,
  optionalTransformer,
  createStripTagsTransformer,
  type Transformer,
  type TransformerContext,
} from '../src/transformers'
import type { Declaration } from '../src/types'

// Helper to create basic transformer context
function createContext(overrides: Partial<TransformerContext> = {}): TransformerContext {
  return {
    filePath: '/test.ts',
    sourceCode: '',
    index: 0,
    total: 1,
    allDeclarations: [],
    createDeclaration,
    cloneDeclaration,
    modifyText: (decl, text) => ({ ...decl, text }),
    addModifier: (decl, mod) => ({ ...decl, modifiers: [...(decl.modifiers || []), mod] }),
    removeModifier: (decl, mod) => ({ ...decl, modifiers: (decl.modifiers || []).filter(m => m !== mod) }),
    ...overrides,
  }
}

describe('createDeclaration', () => {
  it('should create a declaration with required fields', () => {
    const decl = createDeclaration('function', 'foo', 'function foo(): void')
    expect(decl.kind).toBe('function')
    expect(decl.name).toBe('foo')
    expect(decl.text).toBe('function foo(): void')
    expect(decl.isExported).toBe(false)
  })

  it('should accept optional fields', () => {
    const decl = createDeclaration('interface', 'Bar', 'interface Bar {}', {
      isExported: true,
      leadingComments: ['/** Comment */'],
      generics: '<T>',
    })
    expect(decl.isExported).toBe(true)
    expect(decl.leadingComments).toEqual(['/** Comment */'])
    expect(decl.generics).toBe('<T>')
  })
})

describe('cloneDeclaration', () => {
  it('should create a deep copy', () => {
    const original: Declaration = {
      kind: 'interface',
      name: 'Test',
      text: 'interface Test {}',
      isExported: true,
      members: [
        { kind: 'variable', name: 'prop', text: 'prop: string', isExported: false },
      ],
    }

    const clone = cloneDeclaration(original)
    expect(clone).toEqual(original)
    expect(clone).not.toBe(original)
    expect(clone.members).not.toBe(original.members)
  })
})

describe('walkDeclarations', () => {
  const declarations: Declaration[] = [
    {
      kind: 'interface',
      name: 'Parent',
      text: 'interface Parent {}',
      isExported: true,
      members: [
        { kind: 'variable', name: 'child1', text: 'child1: string', isExported: false },
        { kind: 'variable', name: 'child2', text: 'child2: number', isExported: false },
      ],
    },
    {
      kind: 'function',
      name: 'standalone',
      text: 'function standalone(): void',
      isExported: true,
    },
  ]

  it('should visit all declarations', () => {
    const visited: string[] = []
    walkDeclarations(declarations, {
      enter: (decl) => {
        visited.push(decl.name)
      },
    })
    expect(visited).toEqual(['Parent', 'child1', 'child2', 'standalone'])
  })

  it('should call kind-specific visitors', () => {
    const interfaces: string[] = []
    const functions: string[] = []
    const variables: string[] = []

    walkDeclarations(declarations, {
      interface: (decl) => interfaces.push(decl.name),
      function: (decl) => functions.push(decl.name),
      variable: (decl) => variables.push(decl.name),
    })

    expect(interfaces).toEqual(['Parent'])
    expect(functions).toEqual(['standalone'])
    expect(variables).toEqual(['child1', 'child2'])
  })

  it('should call leave after visiting children', () => {
    const order: string[] = []
    walkDeclarations(declarations, {
      enter: (decl) => order.push(`enter:${decl.name}`),
      leave: (decl) => order.push(`leave:${decl.name}`),
    })

    expect(order).toEqual([
      'enter:Parent',
      'enter:child1',
      'leave:child1',
      'enter:child2',
      'leave:child2',
      'leave:Parent',
      'enter:standalone',
      'leave:standalone',
    ])
  })
})

describe('findDeclarations', () => {
  const declarations: Declaration[] = [
    { kind: 'function', name: 'func1', text: '', isExported: true },
    { kind: 'function', name: 'func2', text: '', isExported: false },
    { kind: 'interface', name: 'Interface1', text: '', isExported: true },
    { kind: 'type', name: 'Type1', text: '', isExported: true },
  ]

  it('should find declarations matching predicate', () => {
    const result = findDeclarations(declarations, d => d.kind === 'function')
    expect(result).toHaveLength(2)
    expect(result.map(d => d.name)).toEqual(['func1', 'func2'])
  })

  it('should find exported declarations', () => {
    const result = findDeclarations(declarations, d => d.isExported)
    expect(result).toHaveLength(3)
  })
})

describe('mapDeclarations', () => {
  const declarations: Declaration[] = [
    { kind: 'function', name: 'foo', text: 'function foo(): void', isExported: true },
    { kind: 'function', name: 'bar', text: 'function bar(): void', isExported: true },
  ]

  it('should transform declarations', async () => {
    const transformer: Transformer = (decl) => ({
      ...decl,
      name: decl.name.toUpperCase(),
    })

    const result = await mapDeclarations(declarations, transformer, createContext())
    expect(result.map(d => d.name)).toEqual(['FOO', 'BAR'])
  })

  it('should remove declarations returning null', async () => {
    const transformer: Transformer = (decl) => {
      if (decl.name === 'foo') return null
      return undefined
    }

    const result = await mapDeclarations(declarations, transformer, createContext())
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('bar')
  })

  it('should keep declarations returning undefined', async () => {
    const transformer: Transformer = () => undefined

    const result = await mapDeclarations(declarations, transformer, createContext())
    expect(result).toHaveLength(2)
  })

  it('should handle returning array (split)', async () => {
    const transformer: Transformer = (decl) => {
      if (decl.name === 'foo') {
        return [
          { ...decl, name: 'foo1' },
          { ...decl, name: 'foo2' },
        ]
      }
      return undefined
    }

    const result = await mapDeclarations(declarations, transformer, createContext())
    expect(result).toHaveLength(3)
    expect(result.map(d => d.name)).toEqual(['foo1', 'foo2', 'bar'])
  })
})

describe('composeTransformers', () => {
  it('should compose multiple transformers', async () => {
    const upper: Transformer = (decl) => ({ ...decl, name: decl.name.toUpperCase() })
    const prefix: Transformer = (decl) => ({ ...decl, name: `PREFIX_${decl.name}` })

    const composed = composeTransformers(upper, prefix)
    const decl: Declaration = { kind: 'function', name: 'foo', text: '', isExported: true }

    const result = await composed(decl, createContext())
    expect((result as Declaration).name).toBe('PREFIX_FOO')
  })

  it('should short-circuit on null', async () => {
    const remove: Transformer = () => null
    const shouldNotRun: Transformer = () => {
      throw new Error('Should not run')
    }

    const composed = composeTransformers(remove, shouldNotRun)
    const decl: Declaration = { kind: 'function', name: 'foo', text: '', isExported: true }

    const result = await composed(decl, createContext())
    expect(result).toBeNull()
  })
})

describe('filterByKind', () => {
  it('should only apply to specified kinds', async () => {
    const transformer = filterByKind('function', (decl) => ({
      ...decl,
      name: decl.name.toUpperCase(),
    }))

    const funcDecl: Declaration = { kind: 'function', name: 'foo', text: '', isExported: true }
    const ifaceDecl: Declaration = { kind: 'interface', name: 'bar', text: '', isExported: true }
    const ctx = createContext()

    const funcResult = await transformer(funcDecl, ctx)
    const ifaceResult = await transformer(ifaceDecl, ctx)

    expect((funcResult as Declaration).name).toBe('FOO')
    expect(ifaceResult).toBeUndefined()
  })

  it('should accept array of kinds', async () => {
    const transformer = filterByKind(['function', 'interface'], (decl) => ({
      ...decl,
      name: decl.name.toUpperCase(),
    }))

    const funcDecl: Declaration = { kind: 'function', name: 'foo', text: '', isExported: true }
    const typeDecl: Declaration = { kind: 'type', name: 'bar', text: '', isExported: true }
    const ctx = createContext()

    const funcResult = await transformer(funcDecl, ctx)
    const typeResult = await transformer(typeDecl, ctx)

    expect((funcResult as Declaration).name).toBe('FOO')
    expect(typeResult).toBeUndefined()
  })
})

describe('filterByPredicate', () => {
  it('should only apply when predicate returns true', async () => {
    const transformer = filterByPredicate(
      (decl) => decl.isExported,
      (decl) => ({ ...decl, name: decl.name.toUpperCase() }),
    )

    const exported: Declaration = { kind: 'function', name: 'foo', text: '', isExported: true }
    const notExported: Declaration = { kind: 'function', name: 'bar', text: '', isExported: false }
    const ctx = createContext()

    const exportedResult = await transformer(exported, ctx)
    const notExportedResult = await transformer(notExported, ctx)

    expect((exportedResult as Declaration).name).toBe('FOO')
    expect(notExportedResult).toBeUndefined()
  })
})

describe('createRenameTransformer', () => {
  it('should rename matching declarations', async () => {
    const transformer = createRenameTransformer(/^get/, 'fetch')
    const decl: Declaration = {
      kind: 'function',
      name: 'getData',
      text: 'function getData(): void',
      isExported: true,
    }

    const result = await transformer(decl, createContext())
    expect((result as Declaration).name).toBe('fetchData')
    expect((result as Declaration).text).toContain('fetchData')
  })

  it('should not modify non-matching declarations', async () => {
    const transformer = createRenameTransformer(/^get/, 'fetch')
    const decl: Declaration = {
      kind: 'function',
      name: 'processData',
      text: 'function processData(): void',
      isExported: true,
    }

    const result = await transformer(decl, createContext())
    expect(result).toBeUndefined()
  })
})

describe('createPrefixTransformer', () => {
  it('should add prefix to declarations', async () => {
    const transformer = createPrefixTransformer('My')
    const decl: Declaration = {
      kind: 'interface',
      name: 'Component',
      text: 'interface Component {}',
      isExported: true,
    }

    const result = await transformer(decl, createContext())
    expect((result as Declaration).name).toBe('MyComponent')
  })

  it('should not prefix imports', async () => {
    const transformer = createPrefixTransformer('My')
    const decl: Declaration = {
      kind: 'import',
      name: 'fs',
      text: 'import fs from "node:fs"',
      isExported: false,
    }

    const result = await transformer(decl, createContext())
    expect(result).toBeUndefined()
  })

  it('should respect filter function', async () => {
    const transformer = createPrefixTransformer('Test', (d) => d.kind === 'function')
    const funcDecl: Declaration = { kind: 'function', name: 'foo', text: 'function foo()', isExported: true }
    const ifaceDecl: Declaration = { kind: 'interface', name: 'Bar', text: 'interface Bar {}', isExported: true }
    const ctx = createContext()

    const funcResult = await transformer(funcDecl, ctx)
    const ifaceResult = await transformer(ifaceDecl, ctx)

    expect((funcResult as Declaration).name).toBe('Testfoo')
    expect(ifaceResult).toBeUndefined()
  })
})

describe('createSuffixTransformer', () => {
  it('should add suffix to declarations', async () => {
    const transformer = createSuffixTransformer('Props')
    const decl: Declaration = {
      kind: 'interface',
      name: 'Button',
      text: 'interface Button {}',
      isExported: true,
    }

    const result = await transformer(decl, createContext())
    expect((result as Declaration).name).toBe('ButtonProps')
  })
})

describe('createRemoveTransformer', () => {
  it('should remove declarations by pattern', async () => {
    const transformer = createRemoveTransformer(/^_/)
    const privateDecl: Declaration = { kind: 'function', name: '_internal', text: '', isExported: false }
    const publicDecl: Declaration = { kind: 'function', name: 'public', text: '', isExported: true }
    const ctx = createContext()

    const privateResult = await transformer(privateDecl, ctx)
    const publicResult = await transformer(publicDecl, ctx)

    expect(privateResult).toBeNull()
    expect(publicResult).toBeUndefined()
  })

  it('should remove declarations by predicate', async () => {
    const transformer = createRemoveTransformer((d) => !d.isExported)
    const privateDecl: Declaration = { kind: 'function', name: 'foo', text: '', isExported: false }
    const publicDecl: Declaration = { kind: 'function', name: 'bar', text: '', isExported: true }
    const ctx = createContext()

    const privateResult = await transformer(privateDecl, ctx)
    const publicResult = await transformer(publicDecl, ctx)

    expect(privateResult).toBeNull()
    expect(publicResult).toBeUndefined()
  })
})

describe('createJSDocTransformer', () => {
  it('should add JSDoc comments', async () => {
    const transformer = createJSDocTransformer((decl) => `Description for ${decl.name}`)
    const decl: Declaration = { kind: 'function', name: 'foo', text: '', isExported: true }

    const result = await transformer(decl, createContext())
    expect((result as Declaration).leadingComments).toContain('/** Description for foo */')
  })

  it('should return undefined for null JSDoc', async () => {
    const transformer = createJSDocTransformer(() => null)
    const decl: Declaration = { kind: 'function', name: 'foo', text: '', isExported: true }

    const result = await transformer(decl, createContext())
    expect(result).toBeUndefined()
  })
})

describe('createTypeTransformer', () => {
  it('should transform type annotations', async () => {
    const transformer = createTypeTransformer((type) => type === 'any' ? 'unknown' : undefined)
    const anyDecl: Declaration = {
      kind: 'variable',
      name: 'x',
      text: 'const x: any',
      isExported: true,
      typeAnnotation: 'any',
    }
    const stringDecl: Declaration = {
      kind: 'variable',
      name: 'y',
      text: 'const y: string',
      isExported: true,
      typeAnnotation: 'string',
    }
    const ctx = createContext()

    const anyResult = await transformer(anyDecl, ctx)
    const stringResult = await transformer(stringDecl, ctx)

    expect((anyResult as Declaration).typeAnnotation).toBe('unknown')
    expect(stringResult).toBeUndefined()
  })
})

describe('createModifierTransformer', () => {
  it('should add modifiers', async () => {
    const transformer = createModifierTransformer('declare')
    const decl: Declaration = {
      kind: 'function',
      name: 'foo',
      text: 'function foo(): void',
      isExported: true,
    }

    const result = await transformer(decl, createContext())
    expect((result as Declaration).modifiers).toContain('declare')
  })

  it('should not duplicate existing modifiers', async () => {
    const transformer = createModifierTransformer('declare')
    const decl: Declaration = {
      kind: 'function',
      name: 'foo',
      text: 'declare function foo(): void',
      isExported: true,
      modifiers: ['declare'],
    }

    const result = await transformer(decl, createContext())
    expect(result).toBeUndefined()
  })
})

describe('readonlyTransformer', () => {
  it('should make interface properties readonly', async () => {
    const decl: Declaration = {
      kind: 'interface',
      name: 'Test',
      text: 'interface Test {\n  name: string;\n  value: number;\n}',
      isExported: true,
    }

    const result = await readonlyTransformer(decl, createContext())
    expect((result as Declaration).text).toContain('readonly name')
    expect((result as Declaration).text).toContain('readonly value')
  })

  it('should not modify functions', async () => {
    const decl: Declaration = {
      kind: 'function',
      name: 'foo',
      text: 'function foo(): void',
      isExported: true,
    }

    const result = await readonlyTransformer(decl, createContext())
    expect(result).toBeUndefined()
  })
})

describe('createStripTagsTransformer', () => {
  it('should strip specified JSDoc tags', async () => {
    const transformer = createStripTagsTransformer(['internal', 'deprecated'])
    const decl: Declaration = {
      kind: 'function',
      name: 'foo',
      text: '',
      isExported: true,
      leadingComments: ['/** @internal This is internal @deprecated Use bar instead */'],
    }

    const result = await transformer(decl, createContext())
    expect((result as Declaration).leadingComments![0]).not.toContain('@internal')
    expect((result as Declaration).leadingComments![0]).not.toContain('@deprecated')
  })
})

describe('createTransformerPlugin', () => {
  it('should create a valid plugin', () => {
    const plugin = createTransformerPlugin({
      name: 'test-transformer',
      version: '1.0.0',
      transform: (decl) => ({ ...decl, name: decl.name.toUpperCase() }),
    })

    expect(plugin.name).toBe('test-transformer')
    expect(plugin.version).toBe('1.0.0')
    expect(plugin.onDeclarations).toBeDefined()
  })

  it('should apply beforeParse transformer', async () => {
    const plugin = createTransformerPlugin({
      name: 'test',
      beforeParse: (content) => content.replace('let', 'const'),
    })

    expect(plugin.onBeforeFile).toBeDefined()
  })

  it('should apply afterGenerate transformer', async () => {
    const plugin = createTransformerPlugin({
      name: 'test',
      afterGenerate: (content) => `// Header\n${content}`,
    })

    expect(plugin.onAfterFile).toBeDefined()
  })
})
