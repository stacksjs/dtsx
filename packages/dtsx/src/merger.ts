/**
 * Declaration merging module
 * Merges related declarations (interfaces, namespaces, etc.)
 */

import type { Declaration } from './types'

/**
 * Merge configuration
 */
export interface MergeConfig {
  /**
   * Merge interfaces with the same name
   * @default true
   */
  mergeInterfaces?: boolean

  /**
   * Merge namespaces with the same name
   * @default true
   */
  mergeNamespaces?: boolean

  /**
   * Merge type aliases (when compatible)
   * @default false
   */
  mergeTypes?: boolean

  /**
   * Merge enums with the same name
   * @default true
   */
  mergeEnums?: boolean

  /**
   * Deduplicate identical declarations
   * @default true
   */
  deduplicateIdentical?: boolean

  /**
   * Strategy for handling conflicting members
   * - 'first': Keep the first declaration
   * - 'last': Keep the last declaration
   * - 'error': Throw an error on conflict
   * @default 'last'
   */
  conflictStrategy?: 'first' | 'last' | 'error'

  /**
   * Preserve JSDoc comments from all merged declarations
   * @default true
   */
  preserveAllComments?: boolean
}

/**
 * Result of merge operation
 */
export interface MergeResult {
  /** Merged declarations */
  declarations: Declaration[]
  /** Number of declarations merged */
  mergedCount: number
  /** Details of merges performed */
  merges: MergeDetail[]
}

/**
 * Details of a single merge
 */
export interface MergeDetail {
  /** Name of the declaration */
  name: string
  /** Kind of declaration */
  kind: string
  /** Number of declarations merged */
  sourceCount: number
  /** Number of members after merge */
  memberCount: number
}

/**
 * Merge declarations with the same name
 */
export function mergeDeclarations(
  declarations: Declaration[],
  config: MergeConfig = {},
): MergeResult {
  const {
    mergeInterfaces = true,
    mergeNamespaces = true,
    mergeTypes = false,
    mergeEnums = true,
    deduplicateIdentical = true,
    conflictStrategy = 'last',
    preserveAllComments = true,
  } = config

  const merges: MergeDetail[] = []
  let mergedCount = 0

  // Group declarations by name and kind
  const groups = new Map<string, Declaration[]>()

  for (const decl of declarations) {
    const key = `${decl.kind}:${decl.name}`
    const group = groups.get(key) || []
    group.push(decl)
    groups.set(key, group)
  }

  // Process each group
  const result: Declaration[] = []
  const processed = new Set<string>()

  for (const decl of declarations) {
    const key = `${decl.kind}:${decl.name}`

    // Skip if already processed
    if (processed.has(key)) {
      continue
    }
    processed.add(key)

    const group = groups.get(key)!

    // Single declaration - no merging needed
    if (group.length === 1) {
      result.push(decl)
      continue
    }

    // Check if we should merge this kind
    const shouldMerge =
      (decl.kind === 'interface' && mergeInterfaces) ||
      (decl.kind === 'module' && mergeNamespaces) ||
      (decl.kind === 'type' && mergeTypes) ||
      (decl.kind === 'enum' && mergeEnums)

    if (!shouldMerge) {
      // Keep all declarations as-is
      result.push(...group)
      continue
    }

    // Deduplicate identical declarations first
    let toMerge = group
    if (deduplicateIdentical) {
      toMerge = deduplicateDeclarations(group)
    }

    if (toMerge.length === 1) {
      result.push(toMerge[0])
      continue
    }

    // Merge based on kind
    let merged: Declaration
    switch (decl.kind) {
      case 'interface':
        merged = mergeInterfaces_(toMerge, conflictStrategy, preserveAllComments)
        break
      case 'module':
        merged = mergeNamespaces_(toMerge, conflictStrategy, preserveAllComments)
        break
      case 'enum':
        merged = mergeEnums_(toMerge, conflictStrategy, preserveAllComments)
        break
      case 'type':
        merged = mergeTypeAliases(toMerge, conflictStrategy, preserveAllComments)
        break
      default:
        // Keep first for unsupported kinds
        merged = toMerge[0]
    }

    result.push(merged)
    mergedCount += toMerge.length - 1

    merges.push({
      name: decl.name,
      kind: decl.kind,
      sourceCount: toMerge.length,
      memberCount: merged.members?.length || 0,
    })
  }

  return {
    declarations: result,
    mergedCount,
    merges,
  }
}

/**
 * Remove identical declarations
 */
function deduplicateDeclarations(declarations: Declaration[]): Declaration[] {
  const seen = new Map<string, Declaration>()

  for (const decl of declarations) {
    // Use text as a unique key
    const key = normalizeText(decl.text)

    if (!seen.has(key)) {
      seen.set(key, decl)
    }
    else {
      // Keep the one with more comments
      const existing = seen.get(key)!
      if ((decl.leadingComments?.length || 0) > (existing.leadingComments?.length || 0)) {
        seen.set(key, decl)
      }
    }
  }

  return Array.from(seen.values())
}

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/;\s*/g, ';')
    .trim()
}

/**
 * Merge interface declarations
 */
function mergeInterfaces_(
  interfaces: Declaration[],
  conflictStrategy: 'first' | 'last' | 'error',
  preserveComments: boolean,
): Declaration {
  const base = interfaces[0]
  const allMembers = new Map<string, Declaration>()
  const allComments: string[] = []

  // Collect all members and comments
  for (const iface of interfaces) {
    // Collect comments
    if (preserveComments && iface.leadingComments) {
      for (const comment of iface.leadingComments) {
        if (!allComments.includes(comment)) {
          allComments.push(comment)
        }
      }
    }

    // Collect members
    if (iface.members) {
      for (const member of iface.members) {
        const existing = allMembers.get(member.name)

        if (!existing) {
          allMembers.set(member.name, member)
        }
        else {
          // Handle conflict
          switch (conflictStrategy) {
            case 'first':
              // Keep existing
              break
            case 'last':
              allMembers.set(member.name, member)
              break
            case 'error':
              throw new Error(
                `Conflicting member '${member.name}' in interface '${base.name}'`,
              )
          }
        }
      }
    }
  }

  // Build merged interface text
  const members = Array.from(allMembers.values())
  const memberTexts = members.map(m => `  ${m.text}`).join('\n')

  let generics = base.generics || ''
  let extendsClause = base.extends || ''

  // Collect all extends
  const allExtends = new Set<string>()
  for (const iface of interfaces) {
    if (iface.extends) {
      // Parse extends clause
      const extendsList = iface.extends.replace('extends', '').trim().split(',')
      for (const ext of extendsList) {
        allExtends.add(ext.trim())
      }
    }
  }

  if (allExtends.size > 0) {
    extendsClause = `extends ${Array.from(allExtends).join(', ')}`
  }

  const exportPrefix = base.isExported ? 'export ' : ''
  const declarePrefix = base.modifiers?.includes('declare') ? 'declare ' : ''

  const text = `${exportPrefix}${declarePrefix}interface ${base.name}${generics} ${extendsClause} {\n${memberTexts}\n}`

  return {
    ...base,
    members,
    leadingComments: allComments.length > 0 ? allComments : base.leadingComments,
    text: text.replace(/\s+\{/, ' {').replace(/\{\s*\n\s*\n/, '{\n'),
    extends: extendsClause || undefined,
  }
}

/**
 * Merge namespace/module declarations
 */
function mergeNamespaces_(
  namespaces: Declaration[],
  conflictStrategy: 'first' | 'last' | 'error',
  preserveComments: boolean,
): Declaration {
  const base = namespaces[0]
  const allMembers = new Map<string, Declaration>()
  const allComments: string[] = []

  for (const ns of namespaces) {
    if (preserveComments && ns.leadingComments) {
      for (const comment of ns.leadingComments) {
        if (!allComments.includes(comment)) {
          allComments.push(comment)
        }
      }
    }

    if (ns.members) {
      for (const member of ns.members) {
        const key = `${member.kind}:${member.name}`
        const existing = allMembers.get(key)

        if (!existing) {
          allMembers.set(key, member)
        }
        else {
          switch (conflictStrategy) {
            case 'first':
              break
            case 'last':
              allMembers.set(key, member)
              break
            case 'error':
              throw new Error(
                `Conflicting member '${member.name}' in namespace '${base.name}'`,
              )
          }
        }
      }
    }
  }

  const members = Array.from(allMembers.values())
  const memberTexts = members.map(m => `  ${m.text}`).join('\n')

  const exportPrefix = base.isExported ? 'export ' : ''
  const declarePrefix = base.modifiers?.includes('declare') ? 'declare ' : ''

  const text = `${exportPrefix}${declarePrefix}namespace ${base.name} {\n${memberTexts}\n}`

  return {
    ...base,
    members,
    leadingComments: allComments.length > 0 ? allComments : base.leadingComments,
    text,
  }
}

/**
 * Merge enum declarations
 */
function mergeEnums_(
  enums: Declaration[],
  conflictStrategy: 'first' | 'last' | 'error',
  preserveComments: boolean,
): Declaration {
  const base = enums[0]
  const allMembers = new Map<string, Declaration>()
  const allComments: string[] = []

  for (const en of enums) {
    if (preserveComments && en.leadingComments) {
      for (const comment of en.leadingComments) {
        if (!allComments.includes(comment)) {
          allComments.push(comment)
        }
      }
    }

    if (en.members) {
      for (const member of en.members) {
        const existing = allMembers.get(member.name)

        if (!existing) {
          allMembers.set(member.name, member)
        }
        else {
          switch (conflictStrategy) {
            case 'first':
              break
            case 'last':
              allMembers.set(member.name, member)
              break
            case 'error':
              throw new Error(
                `Conflicting member '${member.name}' in enum '${base.name}'`,
              )
          }
        }
      }
    }
  }

  const members = Array.from(allMembers.values())
  const memberTexts = members.map(m => `  ${m.name}${m.value !== undefined ? ` = ${m.value}` : ''}`).join(',\n')

  const exportPrefix = base.isExported ? 'export ' : ''
  const declarePrefix = base.modifiers?.includes('declare') ? 'declare ' : ''
  const constPrefix = base.modifiers?.includes('const') ? 'const ' : ''

  const text = `${exportPrefix}${declarePrefix}${constPrefix}enum ${base.name} {\n${memberTexts}\n}`

  return {
    ...base,
    members,
    leadingComments: allComments.length > 0 ? allComments : base.leadingComments,
    text,
  }
}

/**
 * Merge type aliases (when they are compatible unions/intersections)
 */
function mergeTypeAliases(
  types: Declaration[],
  _conflictStrategy: 'first' | 'last' | 'error',
  preserveComments: boolean,
): Declaration {
  const base = types[0]
  const allComments: string[] = []

  // Collect all type definitions
  const typeDefinitions: string[] = []

  for (const t of types) {
    if (preserveComments && t.leadingComments) {
      for (const comment of t.leadingComments) {
        if (!allComments.includes(comment)) {
          allComments.push(comment)
        }
      }
    }

    if (t.typeAnnotation) {
      if (!typeDefinitions.includes(t.typeAnnotation)) {
        typeDefinitions.push(t.typeAnnotation)
      }
    }
  }

  // If all types are the same, just return one
  if (typeDefinitions.length <= 1) {
    return {
      ...base,
      leadingComments: allComments.length > 0 ? allComments : base.leadingComments,
    }
  }

  // Create union of all types
  const unionType = typeDefinitions.join(' | ')

  const exportPrefix = base.isExported ? 'export ' : ''
  const generics = base.generics || ''

  const text = `${exportPrefix}type ${base.name}${generics} = ${unionType}`

  return {
    ...base,
    typeAnnotation: unionType,
    leadingComments: allComments.length > 0 ? allComments : base.leadingComments,
    text,
  }
}

/**
 * Merge declarations in content string
 */
export function mergeDeclarationsInContent(
  content: string,
  config: MergeConfig = {},
): string {
  // This is a simplified version that works on text
  // For full support, use extractDeclarations + mergeDeclarations + regenerate

  const lines = content.split('\n')
  const interfaces = new Map<string, { start: number, end: number, content: string[] }[]>()

  // Find all interface blocks
  let current: { name: string, start: number, lines: string[] } | null = null
  let braceCount = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Start of interface
    const interfaceMatch = line.match(/^(export\s+)?(declare\s+)?interface\s+(\w+)/)
    if (interfaceMatch && !current) {
      const name = interfaceMatch[3]
      current = { name, start: i, lines: [line] }
      braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      continue
    }

    // Inside interface
    if (current) {
      current.lines.push(line)
      braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length

      // End of interface
      if (braceCount <= 0) {
        const existing = interfaces.get(current.name) || []
        existing.push({
          start: current.start,
          end: i,
          content: current.lines,
        })
        interfaces.set(current.name, existing)
        current = null
        braceCount = 0
      }
    }
  }

  // No duplicates to merge
  const toMerge = Array.from(interfaces.entries()).filter(([, blocks]) => blocks.length > 1)
  if (toMerge.length === 0) {
    return content
  }

  // Build result with merged interfaces
  const result = [...lines]
  const linesToRemove = new Set<number>()

  for (const [name, blocks] of toMerge) {
    if (blocks.length <= 1) continue

    // Merge all blocks into the first one
    const [first, ...rest] = blocks

    // Extract members from all blocks
    const allMembers: string[] = []
    const seenMembers = new Set<string>()

    for (const block of blocks) {
      for (const line of block.content) {
        const trimmed = line.trim()
        // Skip interface declaration line and closing brace
        if (trimmed.startsWith('interface') || trimmed.startsWith('export') || trimmed === '{' || trimmed === '}') {
          continue
        }
        if (trimmed && !seenMembers.has(trimmed)) {
          seenMembers.add(trimmed)
          allMembers.push(line)
        }
      }
    }

    // Mark lines to remove (all but first block)
    for (const block of rest) {
      for (let i = block.start; i <= block.end; i++) {
        linesToRemove.add(i)
      }
    }

    // Rebuild first block
    const firstDecl = first.content[0]
    const newContent = [
      firstDecl.endsWith('{') ? firstDecl : firstDecl + ' {',
      ...allMembers,
      '}',
    ]

    // Replace first block
    for (let i = first.start; i <= first.end; i++) {
      linesToRemove.add(i)
    }

    result[first.start] = newContent.join('\n')
  }

  // Filter out removed lines
  return result
    .filter((_, i) => !linesToRemove.has(i) || result[i].includes('interface'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}
