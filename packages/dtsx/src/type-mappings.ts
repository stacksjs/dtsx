/**
 * Custom type mappings for DTS generation
 * Allows users to specify type replacements and transformations
 */

/**
 * Type mapping rule
 */
export interface TypeMappingRule {
  /** Pattern to match (string or regex) */
  pattern: string | RegExp
  /** Replacement type */
  replacement: string
  /** Optional condition function */
  condition?: (context: TypeMappingContext) => boolean
  /** Whether to apply globally (default: true) */
  global?: boolean
  /** Priority (higher = applied first, default: 0) */
  priority?: number
}

/**
 * Context passed to type mapping functions
 */
export interface TypeMappingContext {
  /** The type string being transformed */
  type: string
  /** The declaration name */
  declarationName?: string
  /** The declaration kind */
  declarationKind?: string
  /** The file path */
  filePath?: string
  /** Whether this is a return type */
  isReturnType?: boolean
  /** Whether this is a parameter type */
  isParameterType?: boolean
  /** Whether this is a property type */
  isPropertyType?: boolean
}

/**
 * Type mapping configuration
 */
export interface TypeMappingConfig {
  /** Array of mapping rules */
  rules: TypeMappingRule[]
  /** Built-in presets to include */
  presets?: TypeMappingPreset[]
  /** Whether to apply default mappings (default: true) */
  includeDefaults?: boolean
}

/**
 * Available type mapping presets
 */
export type TypeMappingPreset =
  | 'strict' // Convert 'any' to 'unknown'
  | 'readonly' // Add readonly to array types
  | 'nullable' // Convert undefined unions to optional
  | 'branded' // Use branded types for primitives
  | 'simplified' // Simplify complex utility types

/**
 * Default type mappings for common patterns
 */
export const defaultTypeMappings: TypeMappingRule[] = [
  // Convert Promise<void> to Promise<void> (no change, but ensures consistency)
  {
    pattern: /^Promise<void>$/,
    replacement: 'Promise<void>',
    priority: -1,
  },
  // Normalize Record<string, any> to a cleaner form
  {
    pattern: /^Record<string,\s*any>$/,
    replacement: 'Record<string, unknown>',
    priority: 0,
  },
  // Convert Array<T> to T[] for readability
  {
    pattern: /^Array<([^<>]+)>$/,
    replacement: '$1[]',
    priority: 0,
  },
]

/**
 * Strict mode mappings - converts unsafe types
 */
export const strictTypeMappings: TypeMappingRule[] = [
  {
    pattern: /\bany\b/,
    replacement: 'unknown',
    global: true,
    priority: 10,
  },
  {
    pattern: /^object$/,
    replacement: 'Record<string, unknown>',
    priority: 10,
  },
  {
    pattern: /^Function$/,
    replacement: '(...args: unknown[]) => unknown',
    priority: 10,
  },
]

/**
 * Readonly mappings - adds immutability
 */
export const readonlyTypeMappings: TypeMappingRule[] = [
  {
    pattern: /^(\w+)\[\]$/,
    replacement: 'readonly $1[]',
    priority: 5,
  },
  {
    pattern: /^Array<(.+)>$/,
    replacement: 'ReadonlyArray<$1>',
    priority: 5,
  },
  {
    pattern: /^Map<(.+),\s*(.+)>$/,
    replacement: 'ReadonlyMap<$1, $2>',
    priority: 5,
  },
  {
    pattern: /^Set<(.+)>$/,
    replacement: 'ReadonlySet<$1>',
    priority: 5,
  },
]

/**
 * Simplified mappings - reduces complexity
 */
export const simplifiedTypeMappings: TypeMappingRule[] = [
  // Simplify deeply nested Partial/Required
  {
    pattern: /^Partial<Partial<(.+)>>$/,
    replacement: 'Partial<$1>',
    priority: 5,
  },
  {
    pattern: /^Required<Required<(.+)>>$/,
    replacement: 'Required<$1>',
    priority: 5,
  },
  // Simplify Pick followed by Omit
  {
    pattern: /^Pick<Omit<(.+),\s*(.+)>,\s*(.+)>$/,
    replacement: 'Pick<$1, $3>',
    priority: 5,
  },
]

/**
 * Get preset mappings
 */
export function getPresetMappings(preset: TypeMappingPreset): TypeMappingRule[] {
  switch (preset) {
    case 'strict':
      return strictTypeMappings
    case 'readonly':
      return readonlyTypeMappings
    case 'simplified':
      return simplifiedTypeMappings
    case 'nullable':
      return [
        {
          pattern: /^(.+)\s*\|\s*undefined$/,
          replacement: '$1 | undefined',
          priority: 5,
        },
      ]
    case 'branded':
      return [
        {
          pattern: /^string$/,
          replacement: 'string',
          condition: ctx => ctx.declarationKind === 'variable' && (ctx.declarationName?.includes('path') ?? false),
          priority: 5,
        },
      ]
    default:
      return []
  }
}

/** Internal: a TypeMappingRule with its pattern pre-compiled. */
interface CompiledRule {
  rule: TypeMappingRule
  regex: RegExp
}

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g
const MAX_TYPE_MAPPER_CACHE = 2048

/**
 * Type mapper class for applying transformations
 */
export class TypeMapper {
  private rules: TypeMappingRule[]
  private compiled: CompiledRule[] = []
  private cache: Map<string, string> = new Map()

  constructor(config: TypeMappingConfig = { rules: [] }) {
    this.rules = []

    // Add default mappings if enabled
    if (config.includeDefaults !== false) {
      this.rules.push(...defaultTypeMappings)
    }

    // Add preset mappings
    if (config.presets) {
      for (const preset of config.presets) {
        this.rules.push(...getPresetMappings(preset))
      }
    }

    // Add custom rules
    this.rules.push(...config.rules)

    // Sort by priority (higher first)
    this.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0))

    // Pre-compile regexes once. The previous implementation rebuilt every
    // RegExp inside the inner loop on every map() call.
    this.recompile()
  }

  private recompile(): void {
    const compiled: CompiledRule[] = new Array(this.rules.length)
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i]
      const regex = typeof rule.pattern === 'string'
        ? new RegExp(rule.pattern.replace(ESCAPE_REGEX, '\\$&'), rule.global ? 'g' : '')
        : rule.pattern
      compiled[i] = { rule, regex }
    }
    this.compiled = compiled
  }

  /**
   * Apply type mappings to a type string
   */
  map(type: string, context: Partial<TypeMappingContext> = {}): string {
    // Build cache key cheaply: only include context fields when present.
    // The previous JSON.stringify path serialised an empty `{}` per call.
    const ctxIsEmpty = !context.declarationName && !context.declarationKind
      && !context.filePath && !context.isReturnType && !context.isParameterType
      && !context.isPropertyType
    const cacheKey = ctxIsEmpty
      ? type
      : `${type}\x00${context.declarationName ?? ''}\x00${context.declarationKind ?? ''}\x00${context.filePath ?? ''}\x00${context.isReturnType ? 'r' : ''}${context.isParameterType ? 'p' : ''}${context.isPropertyType ? 'P' : ''}`
    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) return cached

    let result = type
    let fullContext: TypeMappingContext | null = null

    for (let i = 0; i < this.compiled.length; i++) {
      const { rule, regex } = this.compiled[i]

      // Check condition if present (lazy-build context only when actually needed)
      if (rule.condition) {
        if (!fullContext) fullContext = { type, ...context }
        if (!rule.condition(fullContext)) continue
      }

      if (regex.test(result)) {
        result = result.replace(regex, rule.replacement)
        if (!rule.global) break
      }
    }

    // Cache result with simple FIFO eviction to keep memory bounded.
    if (this.cache.size >= MAX_TYPE_MAPPER_CACHE) {
      // Drop ~10% of the oldest entries in one pass.
      const toEvict = Math.ceil(MAX_TYPE_MAPPER_CACHE * 0.1)
      let count = 0
      for (const k of this.cache.keys()) {
        if (count++ >= toEvict) break
        this.cache.delete(k)
      }
    }
    this.cache.set(cacheKey, result)
    return result
  }

  /**
   * Map multiple types at once
   */
  mapAll(types: string[], context: Partial<TypeMappingContext> = {}): string[] {
    return types.map(type => this.map(type, { ...context, type }))
  }

  /**
   * Add a rule dynamically
   */
  addRule(rule: TypeMappingRule): void {
    this.rules.push(rule)
    this.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0))
    this.recompile()
    this.cache.clear()
  }

  /**
   * Remove rules matching a pattern
   */
  removeRules(pattern: string | RegExp): number {
    const originalLength = this.rules.length
    this.rules = this.rules.filter((rule) => {
      const rulePattern = typeof rule.pattern === 'string' ? rule.pattern : rule.pattern.source
      return typeof pattern === 'string'
        ? rulePattern !== pattern
        : !pattern.test(rulePattern)
    })
    this.recompile()
    this.cache.clear()
    return originalLength - this.rules.length
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get all rules
   */
  getRules(): readonly TypeMappingRule[] {
    return this.rules
  }
}

/**
 * Create a type mapper with configuration
 */
export function createTypeMapper(config: TypeMappingConfig = { rules: [] }): TypeMapper {
  return new TypeMapper(config)
}

/**
 * Default type mapper instance
 */
export const defaultTypeMapper: TypeMapper = createTypeMapper({ rules: [] })

/**
 * Strict type mapper instance
 */
export const strictTypeMapper: TypeMapper = createTypeMapper({
  rules: [],
  presets: ['strict'],
})

/**
 * Apply type mappings to declaration text
 */
export function applyTypeMappings(
  declarationText: string,
  mapper: TypeMapper,
  context: Partial<TypeMappingContext> = {},
): string {
  // Find all type annotations in the declaration
  // This is a simplified version - a full implementation would use AST
  return declarationText.replace(
    /:\s*([^;,)\]}]+)/g,
    (_match, type) => {
      const mappedType = mapper.map(type.trim(), context)
      return `: ${mappedType}`
    },
  )
}

/**
 * Built-in type transformers
 */
export const TypeTransformers = {
  /**
   * Make all types readonly
   */
  makeReadonly: (type: string): string => {
    if (type.endsWith('[]')) {
      return `readonly ${type}`
    }
    if (type.startsWith('Array<')) {
      return type.replace('Array<', 'ReadonlyArray<')
    }
    return type
  },

  /**
   * Make type nullable
   */
  makeNullable: (type: string): string => {
    if (type.includes('| null') || type.includes('| undefined')) {
      return type
    }
    return `${type} | null`
  },

  /**
   * Make type optional (add undefined)
   */
  makeOptional: (type: string): string => {
    if (type.includes('| undefined')) {
      return type
    }
    return `${type} | undefined`
  },

  /**
   * Remove null/undefined from type
   */
  makeRequired: (type: string): string => {
    return type
      .replace(/\s*\|\s*null/g, '')
      .replace(/\s*\|\s*undefined/g, '')
      .trim()
  },

  /**
   * Wrap in Promise
   */
  promisify: (type: string): string => {
    if (type.startsWith('Promise<')) {
      return type
    }
    return `Promise<${type}>`
  },

  /**
   * Unwrap Promise
   */
  unpromisify: (type: string): string => {
    const match = type.match(/^Promise<(.+)>$/)
    return match ? match[1] : type
  },

  /**
   * Convert to array type
   */
  arrayify: (type: string): string => {
    if (type.endsWith('[]') || type.startsWith('Array<')) {
      return type
    }
    return `${type}[]`
  },

  /**
   * Unwrap array type
   */
  unarrayify: (type: string): string => {
    if (type.endsWith('[]')) {
      return type.slice(0, -2)
    }
    const match = type.match(/^(?:Readonly)?Array<(.+)>$/)
    return match ? match[1] : type
  },
}
