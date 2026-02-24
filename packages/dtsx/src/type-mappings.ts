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

/**
 * Type mapper class for applying transformations
 */
export class TypeMapper {
  private rules: TypeMappingRule[]
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
  }

  /**
   * Apply type mappings to a type string
   */
  map(type: string, context: Partial<TypeMappingContext> = {}): string {
    // Check cache
    const cacheKey = `${type}:${JSON.stringify(context)}`
    const cached = this.cache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    let result = type
    const fullContext: TypeMappingContext = {
      type,
      ...context,
    }

    for (const rule of this.rules) {
      // Check condition if present
      if (rule.condition && !rule.condition(fullContext)) {
        continue
      }

      const pattern = typeof rule.pattern === 'string'
        ? new RegExp(rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), rule.global ? 'g' : '')
        : rule.pattern

      if (pattern.test(result)) {
        result = result.replace(pattern, rule.replacement)
        // If not global, only apply first matching rule
        if (!rule.global) {
          break
        }
      }
    }

    // Cache result
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
