/**
 * Import sorting module for organizing imports in declaration files
 */

/**
 * Import sorting configuration
 */
export interface ImportSortConfig {
  /**
   * Priority patterns for import sources
   * Imports matching earlier patterns appear first
   * @example ['node:', 'bun', '@myorg/', '^[a-z]', '^\\.']
   */
  order?: string[]

  /**
   * Group imports by type with blank lines between groups
   * @default true
   */
  groupByType?: boolean

  /**
   * Sort groups:
   * - 'builtin': Node.js built-in modules (node:*)
   * - 'external': External packages
   * - 'internal': Internal/aliased imports (@/*)
   * - 'parent': Parent directory imports (../)
   * - 'sibling': Same directory imports (./)
   * - 'index': Index imports (.)
   * - 'type': Type-only imports
   */
  groups?: ImportGroup[]

  /**
   * Sort imports alphabetically within groups
   * @default true
   */
  alphabetize?: boolean

  /**
   * Case-insensitive sorting
   * @default true
   */
  caseInsensitive?: boolean

  /**
   * Put type imports at the end of each group
   * @default false
   */
  typeImportsLast?: boolean

  /**
   * Separate type imports into their own group
   * @default false
   */
  separateTypeImports?: boolean

  /**
   * Custom group definitions
   */
  customGroups?: Record<string, string[]>
}

/**
 * Import group types
 */
export type ImportGroup =
  | 'builtin'
  | 'external'
  | 'internal'
  | 'parent'
  | 'sibling'
  | 'index'
  | 'type'
  | 'unknown'
  | string // Custom group name

/**
 * Parsed import information
 */
export interface ParsedImport {
  /** Full import statement */
  statement: string
  /** Import source/path */
  source: string
  /** Whether it's a type-only import */
  isTypeOnly: boolean
  /** Detected group */
  group: ImportGroup
  /** Specifiers (named imports) */
  specifiers: string[]
  /** Default import name */
  defaultImport?: string
  /** Namespace import name */
  namespaceImport?: string
  /** Original line number */
  lineNumber?: number
}

/**
 * Default import group order
 */
export const DEFAULT_GROUP_ORDER: ImportGroup[] = [
  'builtin',
  'external',
  'internal',
  'parent',
  'sibling',
  'index',
  'type',
  'unknown',
]

/**
 * Parse an import statement
 */
export function parseImport(statement: string): ParsedImport | null {
  // Match: import ... from '...'
  const importMatch = statement.match(
    /^(import\s+)(type\s+)?(.+?)\s+from\s+['"]([^'"]+)['"]/,
  )

  if (!importMatch) {
    // Side-effect import: import '...'
    const sideEffectMatch = statement.match(/^import\s+['"]([^'"]+)['"]/)
    if (sideEffectMatch) {
      return {
        statement,
        source: sideEffectMatch[1],
        isTypeOnly: false,
        group: detectGroup(sideEffectMatch[1]),
        specifiers: [],
      }
    }
    return null
  }

  const [, , typeKeyword, imports, source] = importMatch
  const isTypeOnly = !!typeKeyword

  // Parse import specifiers
  let defaultImport: string | undefined
  let namespaceImport: string | undefined
  const specifiers: string[] = []

  const importPart = imports.trim()

  // Namespace import: * as name
  const namespaceMatch = importPart.match(/^\*\s+as\s+(\w+)$/)
  if (namespaceMatch) {
    namespaceImport = namespaceMatch[1]
  }
  // Default + named: name, { ... }
  else if (importPart.includes('{')) {
    const defaultMatch = importPart.match(/^(\w+)\s*,/)
    if (defaultMatch) {
      defaultImport = defaultMatch[1]
    }

    const namedMatch = importPart.match(/\{([^}]+)\}/)
    if (namedMatch) {
      const named = namedMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      specifiers.push(...named)
    }
  }
  // Default only
  else if (/^\w+$/.test(importPart)) {
    defaultImport = importPart
  }
  // Named only: { ... }
  else {
    const namedMatch = importPart.match(/\{([^}]+)\}/)
    if (namedMatch) {
      const named = namedMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      specifiers.push(...named)
    }
  }

  return {
    statement,
    source,
    isTypeOnly,
    group: detectGroup(source, isTypeOnly),
    specifiers,
    defaultImport,
    namespaceImport,
  }
}

/**
 * Detect the group for an import source
 */
export function detectGroup(source: string, isTypeOnly = false): ImportGroup {
  if (isTypeOnly) {
    return 'type'
  }

  // Node.js built-in modules
  if (source.startsWith('node:') || isBuiltinModule(source)) {
    return 'builtin'
  }

  // Relative imports
  if (source.startsWith('./')) {
    return 'sibling'
  }

  if (source.startsWith('../')) {
    return 'parent'
  }

  if (source === '.' || source === './index') {
    return 'index'
  }

  // Internal/aliased imports (common patterns)
  if (source.startsWith('@/') || source.startsWith('~/') || source.startsWith('#')) {
    return 'internal'
  }

  // Scoped packages or external
  if (source.startsWith('@') || /^[a-z]/.test(source)) {
    return 'external'
  }

  return 'unknown'
}

/**
 * Check if a module is a Node.js built-in
 */
function isBuiltinModule(name: string): boolean {
  const builtins = [
    'assert',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'dns',
    'domain',
    'events',
    'fs',
    'http',
    'https',
    'module',
    'net',
    'os',
    'path',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'string_decoder',
    'sys',
    'timers',
    'tls',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'wasi',
    'worker_threads',
    'zlib',
  ]
  return builtins.includes(name)
}

/**
 * Sort imports according to configuration
 */
export function sortImports(
  imports: string[],
  config: ImportSortConfig = {},
): string[] {
  const {
    order = [],
    groupByType = true,
    groups = DEFAULT_GROUP_ORDER,
    alphabetize = true,
    caseInsensitive = true,
    typeImportsLast = false,
    separateTypeImports: _separateTypeImports = false,
  } = config

  // Parse all imports
  const parsed: ParsedImport[] = []
  for (const imp of imports) {
    const p = parseImport(imp)
    if (p) {
      parsed.push(p)
    }
    else {
      // Keep unparseable imports as-is
      parsed.push({
        statement: imp,
        source: '',
        isTypeOnly: false,
        group: 'unknown',
        specifiers: [],
      })
    }
  }

  // Sort function
  const sortFn = (a: ParsedImport, b: ParsedImport): number => {
    // First, check custom order patterns
    if (order.length > 0) {
      const aOrderIdx = findOrderIndex(a.source, order)
      const bOrderIdx = findOrderIndex(b.source, order)

      if (aOrderIdx !== bOrderIdx) {
        return aOrderIdx - bOrderIdx
      }
    }

    // Group by type
    if (groupByType) {
      const aGroupIdx = groups.indexOf(a.group as ImportGroup)
      const bGroupIdx = groups.indexOf(b.group as ImportGroup)

      const aIdx = aGroupIdx >= 0 ? aGroupIdx : groups.length
      const bIdx = bGroupIdx >= 0 ? bGroupIdx : groups.length

      if (aIdx !== bIdx) {
        return aIdx - bIdx
      }
    }

    // Type imports handling within group
    if (typeImportsLast && a.isTypeOnly !== b.isTypeOnly) {
      return a.isTypeOnly ? 1 : -1
    }

    // Alphabetize
    if (alphabetize) {
      const aSource = caseInsensitive ? a.source.toLowerCase() : a.source
      const bSource = caseInsensitive ? b.source.toLowerCase() : b.source
      return aSource.localeCompare(bSource)
    }

    return 0
  }

  // Sort imports
  parsed.sort(sortFn)

  // Add blank lines between groups if groupByType is enabled
  if (groupByType) {
    const result: string[] = []
    let lastGroup: ImportGroup | null = null

    for (const imp of parsed) {
      // Add blank line between different groups
      if (lastGroup !== null && imp.group !== lastGroup) {
        // Check if there's actually a group boundary
        const lastIdx = groups.indexOf(lastGroup as ImportGroup)
        const currIdx = groups.indexOf(imp.group as ImportGroup)

        if (lastIdx >= 0 && currIdx >= 0 && lastIdx !== currIdx) {
          result.push('')
        }
      }

      result.push(imp.statement)
      lastGroup = imp.group
    }

    return result
  }

  return parsed.map(p => p.statement)
}

/**
 * Find the order index for a source
 */
function findOrderIndex(source: string, order: string[]): number {
  for (let i = 0; i < order.length; i++) {
    const pattern = order[i]

    // Check if pattern is a regex (starts with ^)
    if (pattern.startsWith('^')) {
      try {
        const regex = new RegExp(pattern)
        if (regex.test(source)) {
          return i
        }
      }
      catch {
        // Invalid regex, treat as prefix
        if (source.startsWith(pattern.slice(1))) {
          return i
        }
      }
    }
    // Prefix match
    else if (source.startsWith(pattern) || source.includes(`/${pattern}`)) {
      return i
    }
  }

  return order.length // Not found, put at end
}

/**
 * Sort imports in a file content
 */
export function sortImportsInContent(
  content: string,
  config: ImportSortConfig = {},
): string {
  const lines = content.split('\n')
  const imports: string[] = []
  const importStartIdx: number[] = []
  let importEndIdx = -1

  // Find all import statements
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (line.startsWith('import ')) {
      imports.push(lines[i])
      importStartIdx.push(i)
      importEndIdx = i
    }
    else if (imports.length > 0 && line === '') {
      // Skip blank lines within import block
      continue
    }
    else if (imports.length > 0 && !line.startsWith('import ')) {
      // End of import block
      break
    }
  }

  if (imports.length === 0) {
    return content
  }

  // Sort imports
  const sorted = sortImports(imports, config)

  // Reconstruct content
  const beforeImports = lines.slice(0, importStartIdx[0])
  const afterImports = lines.slice(importEndIdx + 1)

  // Skip leading blank lines in afterImports
  while (afterImports.length > 0 && afterImports[0].trim() === '') {
    afterImports.shift()
  }

  return [
    ...beforeImports,
    ...sorted,
    '',
    ...afterImports,
  ].join('\n')
}

/**
 * Create a configured import sorter
 */
export function createImportSorter(config: ImportSortConfig = {}): {
  sort: (imports: string[]) => string[]
  sortContent: (content: string) => string
  parse: typeof parseImport
  detectGroup: typeof detectGroup
} {
  return {
    sort: (imports: string[]): string[] => sortImports(imports, config),
    sortContent: (content: string): string => sortImportsInContent(content, config),
    parse: parseImport,
    detectGroup,
  }
}

/**
 * Preset configurations
 */
export const presets = {
  /**
   * Default preset - groups by type, alphabetizes
   */
  default: {
    groupByType: true,
    groups: DEFAULT_GROUP_ORDER,
    alphabetize: true,
    caseInsensitive: true,
  } as ImportSortConfig,

  /**
   * Node.js style - node: first, then external, then relative
   */
  node: {
    order: ['node:'],
    groupByType: true,
    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
    alphabetize: true,
  } as ImportSortConfig,

  /**
   * Bun style - bun first
   */
  bun: {
    order: ['bun', 'node:'],
    groupByType: true,
    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
    alphabetize: true,
  } as ImportSortConfig,

  /**
   * Type imports separated
   */
  typeSeparated: {
    groupByType: true,
    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
    separateTypeImports: true,
    alphabetize: true,
  } as ImportSortConfig,

  /**
   * No grouping, just alphabetize
   */
  alphabetical: {
    groupByType: false,
    alphabetize: true,
    caseInsensitive: true,
  } as ImportSortConfig,

  /**
   * Keep original order
   */
  none: {
    groupByType: false,
    alphabetize: false,
  } as ImportSortConfig,
}
