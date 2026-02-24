import type { DeclarationContext, Plugin, TransformContext } from './plugins'
import type { Declaration, DeclarationKind, ParameterDeclaration } from './types'
import { definePlugin } from './plugins'

/**
 * Result of a transformer, can be:
 * - Declaration: replaced declaration
 * - Declaration[]: multiple declarations (split)
 * - null: remove the declaration
 * - undefined: no change
 */
export type TransformResult = Declaration | Declaration[] | null | undefined

/**
 * Transformer function that operates on a single declaration
 */
export type Transformer = (
  declaration: Declaration,
  context: TransformerContext,
) => TransformResult | Promise<TransformResult>

/**
 * Context available to transformers
 */
export interface TransformerContext {
  /** Current file being processed */
  filePath: string
  /** Original source code */
  sourceCode: string
  /** Index of current declaration */
  index: number
  /** Total number of declarations */
  total: number
  /** Access to all declarations (read-only) */
  allDeclarations: readonly Declaration[]
  /** Helper to create a new declaration */
  createDeclaration: typeof createDeclaration
  /** Helper to clone a declaration */
  cloneDeclaration: typeof cloneDeclaration
  /** Helper to modify declaration text */
  modifyText: (decl: Declaration, text: string) => Declaration
  /** Helper to add a modifier */
  addModifier: (decl: Declaration, modifier: string) => Declaration
  /** Helper to remove a modifier */
  removeModifier: (decl: Declaration, modifier: string) => Declaration
}

/**
 * Text transformer operates on the raw text before/after processing
 */
export type TextTransformer = (
  content: string,
  context: TextTransformerContext,
) => string | Promise<string>

/**
 * Context for text transformers
 */
export interface TextTransformerContext {
  /** Current file being processed */
  filePath: string
  /** Phase: 'before' = before parsing, 'after' = after generation */
  phase: 'before' | 'after'
}

/**
 * Visitor pattern for walking declaration trees
 */
export interface DeclarationVisitor {
  /** Visit any declaration */
  enter?: (decl: Declaration, parent: Declaration | null) => void
  /** Called after visiting children */
  leave?: (decl: Declaration, parent: Declaration | null) => void
  /** Visit specific declaration kinds */
  function?: (_decl: Declaration, _parent: Declaration | null) => void
  variable?: (decl: Declaration, parent: Declaration | null) => void
  interface?: (decl: Declaration, parent: Declaration | null) => void
  type?: (decl: Declaration, parent: Declaration | null) => void
  class?: (decl: Declaration, parent: Declaration | null) => void
  enum?: (decl: Declaration, parent: Declaration | null) => void
  import?: (decl: Declaration, parent: Declaration | null) => void
  export?: (decl: Declaration, parent: Declaration | null) => void
  module?: (decl: Declaration, parent: Declaration | null) => void
  namespace?: (decl: Declaration, parent: Declaration | null) => void
  unknown?: (decl: Declaration, parent: Declaration | null) => void
}

/**
 * Create a new declaration with defaults
 */
export function createDeclaration(
  kind: DeclarationKind,
  name: string,
  text: string,
  options: Partial<Omit<Declaration, 'kind' | 'name' | 'text'>> = {},
): Declaration {
  return {
    kind,
    name,
    text,
    isExported: options.isExported ?? false,
    ...options,
  }
}

/**
 * Clone a declaration (deep copy)
 */
export function cloneDeclaration(decl: Declaration): Declaration {
  return JSON.parse(JSON.stringify(decl))
}

/**
 * Walk declarations with a visitor
 */
export function walkDeclarations(
  declarations: Declaration[],
  visitor: DeclarationVisitor,
  parent: Declaration | null = null,
): void {
  for (const decl of declarations) {
    // Call enter hook
    visitor.enter?.(decl, parent)

    // Call kind-specific hook
    const kindVisitor = visitor[decl.kind]
    if (kindVisitor) {
      kindVisitor(decl, parent)
    }

    // Recursively visit members
    if (decl.members && decl.members.length > 0) {
      walkDeclarations(decl.members, visitor, decl)
    }

    // Call leave hook
    visitor.leave?.(decl, parent)
  }
}

/**
 * Find declarations matching a predicate
 */
export function findDeclarations(
  declarations: Declaration[],
  predicate: (decl: Declaration) => boolean,
): Declaration[] {
  const results: Declaration[] = []

  walkDeclarations(declarations, {
    enter: (decl) => {
      if (predicate(decl)) {
        results.push(decl)
      }
    },
  })

  return results
}

/**
 * Map declarations with a transformer
 */
export async function mapDeclarations(
  declarations: Declaration[],
  transformer: Transformer,
  context: Omit<TransformerContext, 'index' | 'total' | 'allDeclarations'>,
): Promise<Declaration[]> {
  const results: Declaration[] = []
  const total = declarations.length

  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i]
    const fullContext: TransformerContext = {
      ...context,
      index: i,
      total,
      allDeclarations: declarations,
    }

    const result = await transformer(decl, fullContext)

    if (result === null) {
      // Remove declaration
      continue
    }
    else if (result === undefined) {
      // No change
      results.push(decl)
    }
    else if (Array.isArray(result)) {
      // Multiple declarations
      results.push(...result)
    }
    else {
      // Replaced declaration
      results.push(result)
    }
  }

  return results
}

/**
 * Compose multiple transformers into one
 */
export function composeTransformers(...transformers: Transformer[]): Transformer {
  return async (decl, context) => {
    let current: Declaration | Declaration[] | null = decl

    for (const transformer of transformers) {
      if (current === null) {
        return null
      }

      if (Array.isArray(current)) {
        // Apply transformer to each declaration in the array
        const results: Declaration[] = []
        for (const d of current) {
          const result = await transformer(d, context)
          if (result === null)
            continue
          if (result === undefined)
            results.push(d)
          else if (Array.isArray(result))
            results.push(...result)
          else results.push(result)
        }
        current = results.length > 0 ? results : null
      }
      else {
        const result = await transformer(current, context)
        if (result === null) {
          current = null
        }
        else if (result === undefined) {
          // No change, keep current
        }
        else {
          current = result
        }
      }
    }

    return current
  }
}

/**
 * Create a transformer that only applies to specific declaration kinds
 */
export function filterByKind(
  kinds: DeclarationKind | DeclarationKind[],
  transformer: Transformer,
): Transformer {
  const kindSet = new Set(Array.isArray(kinds) ? kinds : [kinds])

  return async (decl, context) => {
    if (kindSet.has(decl.kind)) {
      return transformer(decl, context)
    }
    return undefined // No change
  }
}

/**
 * Create a transformer that only applies when a predicate is true
 */
export function filterByPredicate(
  predicate: (decl: Declaration) => boolean,
  transformer: Transformer,
): Transformer {
  return async (decl, context) => {
    if (predicate(decl)) {
      return transformer(decl, context)
    }
    return undefined
  }
}

/**
 * Create a transformer plugin from transformers
 */
export function createTransformerPlugin(options: {
  name: string
  version?: string
  description?: string
  /** Transform source code before parsing */
  beforeParse?: TextTransformer
  /** Transform declarations */
  transform?: Transformer
  /** Transform generated .d.ts content after generation */
  afterGenerate?: TextTransformer
}): Plugin {
  const helpers = {
    createDeclaration,
    cloneDeclaration,
    modifyText: (decl: Declaration, text: string): Declaration => ({ ...decl, text }),
    addModifier: (decl: Declaration, modifier: string): Declaration => ({
      ...decl,
      modifiers: [...(decl.modifiers || []), modifier],
    }),
    removeModifier: (decl: Declaration, modifier: string): Declaration => ({
      ...decl,
      modifiers: (decl.modifiers || []).filter(m => m !== modifier),
    }),
  }

  return definePlugin({
    name: options.name,
    version: options.version,
    description: options.description,

    onBeforeFile: options.beforeParse
      ? async (ctx: TransformContext) => {
        return options.beforeParse!(ctx.content, {
          filePath: ctx.filePath,
          phase: 'before',
        })
      }
      : undefined,

    onDeclarations: options.transform
      ? async (ctx: DeclarationContext) => {
        return mapDeclarations(ctx.declarations, options.transform!, {
          filePath: ctx.filePath,
          sourceCode: ctx.sourceCode,
          ...helpers,
        })
      }
      : undefined,

    onAfterFile: options.afterGenerate
      ? async (ctx: TransformContext) => {
        return options.afterGenerate!(ctx.content, {
          filePath: ctx.filePath,
          phase: 'after',
        })
      }
      : undefined,
  })
}

// ============================================================================
// Built-in Transformers
// ============================================================================

/**
 * Rename declarations matching a pattern
 */
export function createRenameTransformer(
  pattern: string | RegExp,
  replacement: string | ((_match: string, _decl: Declaration) => string),
): Transformer {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern

  return (decl) => {
    if (regex.test(decl.name)) {
      const newName = typeof replacement === 'function'
        ? replacement(decl.name, decl)
        : decl.name.replace(regex, replacement)

      // Update the text as well
      const newText = decl.text.replace(
        new RegExp(`\\b${escapeRegExp(decl.name)}\\b`),
        newName,
      )

      return {
        ...decl,
        name: newName,
        text: newText,
      }
    }
    return undefined
  }
}

/**
 * Add a prefix to declaration names
 */
export function createPrefixTransformer(
  prefix: string,
  filter?: (decl: Declaration) => boolean,
): Transformer {
  return (decl) => {
    if (decl.kind === 'import')
      return undefined // Don't prefix imports
    if (filter && !filter(decl))
      return undefined

    const newName = `${prefix}${decl.name}`
    const newText = decl.text.replace(
      new RegExp(`\\b${escapeRegExp(decl.name)}\\b`),
      newName,
    )

    return { ...decl, name: newName, text: newText }
  }
}

/**
 * Add a suffix to declaration names
 */
export function createSuffixTransformer(
  suffix: string,
  filter?: (decl: Declaration) => boolean,
): Transformer {
  return (decl) => {
    if (decl.kind === 'import')
      return undefined
    if (filter && !filter(decl))
      return undefined

    const newName = `${decl.name}${suffix}`
    const newText = decl.text.replace(
      new RegExp(`\\b${escapeRegExp(decl.name)}\\b`),
      newName,
    )

    return { ...decl, name: newName, text: newText }
  }
}

/**
 * Remove declarations by name pattern
 */
export function createRemoveTransformer(
  pattern: string | RegExp | ((_decl: Declaration) => boolean),
): Transformer {
  const shouldRemove = typeof pattern === 'function'
    ? pattern
    : (decl: Declaration) => {
        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
        return regex.test(decl.name)
      }

  return (decl) => {
    if (shouldRemove(decl)) {
      return null
    }
    return undefined
  }
}

/**
 * Add JSDoc comments to declarations
 */
export function createJSDocTransformer(
  getJSDoc: (decl: Declaration) => string | string[] | null | undefined,
): Transformer {
  return (decl) => {
    const jsdoc = getJSDoc(decl)
    if (!jsdoc)
      return undefined

    const comments = Array.isArray(jsdoc) ? jsdoc : [jsdoc]
    const formatted = comments.map((c) => {
      if (c.startsWith('/**'))
        return c
      if (c.startsWith('/*'))
        return c
      return `/** ${c} */`
    })

    return {
      ...decl,
      leadingComments: [...(decl.leadingComments || []), ...formatted],
    }
  }
}

/**
 * Modify type annotations
 */
export function createTypeTransformer(
  transformer: (type: string, decl: Declaration) => string | null | undefined,
): Transformer {
  return (decl) => {
    if (!decl.typeAnnotation)
      return undefined

    const newType = transformer(decl.typeAnnotation, decl)
    if (newType === null)
      return null
    if (newType === undefined)
      return undefined

    // Update the text to reflect the new type
    const newText = decl.text.replace(
      new RegExp(`:[ ]*${escapeRegExp(decl.typeAnnotation)}`),
      `: ${newType}`,
    )

    return {
      ...decl,
      typeAnnotation: newType,
      text: newText,
    }
  }
}

/**
 * Modify return types of functions
 */
export function createReturnTypeTransformer(
  transformer: (returnType: string, decl: Declaration) => string | null | undefined,
): Transformer {
  return filterByKind('function', (decl) => {
    if (!decl.returnType)
      return undefined

    const newType = transformer(decl.returnType, decl)
    if (newType === null)
      return null
    if (newType === undefined)
      return undefined

    // Update the text to reflect the new return type
    const newText = decl.text.replace(
      new RegExp(`\\):[ ]*${escapeRegExp(decl.returnType)}`),
      `): ${newType}`,
    )

    return {
      ...decl,
      returnType: newType,
      text: newText,
    }
  })
}

/**
 * Transform function parameters
 */
export function createParameterTransformer(
  transformer: (
    params: ParameterDeclaration[],
    decl: Declaration,
  ) => ParameterDeclaration[] | null | undefined,
): Transformer {
  return filterByKind(['function', 'class'], (decl) => {
    if (!decl.parameters)
      return undefined

    const newParams = transformer(decl.parameters, decl)
    if (newParams === null)
      return null
    if (newParams === undefined)
      return undefined

    // Rebuild the parameter string
    const paramStr = newParams
      .map((p) => {
        let s = ''
        if (p.rest)
          s += '...'
        s += p.name
        if (p.optional)
          s += '?'
        if (p.type)
          s += `: ${p.type}`
        if (p.defaultValue)
          s += ` = ${p.defaultValue}`
        return s
      })
      .join(', ')

    // Replace parameters in text (simplified - may need adjustment for complex cases)
    const newText = decl.text.replace(
      /\([^)]*\)/,
      `(${paramStr})`,
    )

    return {
      ...decl,
      parameters: newParams,
      text: newText,
    }
  })
}

/**
 * Add modifiers (export, declare, etc.)
 */
export function createModifierTransformer(
  modifier: string,
  filter?: (decl: Declaration) => boolean,
): Transformer {
  return (decl) => {
    if (filter && !filter(decl))
      return undefined
    if (decl.modifiers?.includes(modifier))
      return undefined

    const newModifiers = [...(decl.modifiers || []), modifier]

    // Add modifier to text if not present
    let newText = decl.text
    if (!newText.includes(modifier)) {
      // Insert modifier before the declaration keyword
      const keywords = ['function', 'class', 'interface', 'type', 'enum', 'const', 'let', 'var']
      for (const kw of keywords) {
        const idx = newText.indexOf(kw)
        if (idx >= 0) {
          newText = `${newText.slice(0, idx)}${modifier} ${newText.slice(idx)}`
          break
        }
      }
    }

    return {
      ...decl,
      modifiers: newModifiers,
      text: newText,
    }
  }
}

/**
 * Make all declarations readonly (for interfaces/types)
 */
export const readonlyTransformer: Transformer = filterByKind(
  ['interface', 'type'],
  (decl) => {
    // Add readonly modifier to all properties
    const newText = decl.text.replace(
      /(\n\s*)(\w+)(\??:\s)/g,
      '$1readonly $2$3',
    )

    if (newText === decl.text)
      return undefined

    return { ...decl, text: newText }
  },
)

/**
 * Make all optional properties required
 */
export const requiredTransformer: Transformer = filterByKind(
  ['interface', 'type'],
  (decl) => {
    // Remove optional markers
    const newText = decl.text.replace(
      /(\w+)\?:/g,
      '$1:',
    )

    if (newText === decl.text)
      return undefined

    return { ...decl, text: newText }
  },
)

/**
 * Make all required properties optional
 */
export const optionalTransformer: Transformer = filterByKind(
  ['interface', 'type'],
  (decl) => {
    // Add optional markers (avoid adding to already optional)
    const newText = decl.text.replace(
      /(\w+)(?<!\?):/g,
      '$1?:',
    )

    if (newText === decl.text)
      return undefined

    return { ...decl, text: newText }
  },
)

/**
 * Strip specific JSDoc tags
 */
export function createStripTagsTransformer(tags: string[]): Transformer {
  const tagPattern = new RegExp(`@(${tags.join('|')})\\b[^@]*`, 'g')

  return (decl) => {
    if (!decl.leadingComments?.length)
      return undefined

    const newComments = decl.leadingComments.map((comment) => {
      return comment.replace(tagPattern, '').replace(/\n\s*\*\s*\n/g, '\n')
    })

    // Check if anything changed
    const changed = newComments.some((c, i) => c !== decl.leadingComments![i])
    if (!changed)
      return undefined

    return { ...decl, leadingComments: newComments }
  }
}

/**
 * Wrap types in a utility type
 */
export function createWrapTypeTransformer(
  utilityType: string,
  filter?: (decl: Declaration) => boolean,
): Transformer {
  return (decl) => {
    if (filter && !filter(decl))
      return undefined
    if (!decl.typeAnnotation)
      return undefined

    const newType = `${utilityType}<${decl.typeAnnotation}>`
    const newText = decl.text.replace(
      decl.typeAnnotation,
      newType,
    )

    return {
      ...decl,
      typeAnnotation: newType,
      text: newText,
    }
  }
}

// ============================================================================
// Pre-built Transformer Plugins
// ============================================================================

/**
 * Plugin that makes all interface properties readonly
 */
export const readonlyPlugin: Plugin = createTransformerPlugin({
  name: 'readonly',
  version: '1.0.0',
  description: 'Makes all interface properties readonly',
  transform: readonlyTransformer,
})

/**
 * Plugin that strips @internal, @private, and @hidden tags
 */
export const stripPrivatePlugin: Plugin = createTransformerPlugin({
  name: 'strip-private',
  version: '1.0.0',
  description: 'Strips @internal, @private, and @hidden declarations',
  transform: createRemoveTransformer((decl) => {
    if (!decl.leadingComments)
      return false
    return decl.leadingComments.some(
      c => /@(internal|private|hidden)\b/.test(c),
    )
  }),
})

/**
 * Plugin that adds 'declare' keyword to all declarations
 */
export const declarePlugin: Plugin = createTransformerPlugin({
  name: 'declare',
  version: '1.0.0',
  description: 'Adds declare keyword to all declarations',
  transform: createModifierTransformer('declare', decl => decl.kind !== 'import'),
})

/**
 * Plugin that prefixes all exported types with a namespace
 */
export function createNamespacePrefixPlugin(namespace: string): Plugin {
  return createTransformerPlugin({
    name: `namespace-prefix-${namespace}`,
    version: '1.0.0',
    description: `Prefixes exported declarations with ${namespace}`,
    transform: createPrefixTransformer(
      `${namespace}_`,
      decl => decl.isExported && decl.kind !== 'import',
    ),
  })
}

// ============================================================================
// Utility Functions
// ============================================================================

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
