import type { ProcessingState, PropertyInfo } from './types'
import { debugLog } from './utils'

/**
 * Format the final output with proper spacing and organization
 */
export function formatOutput(state: ProcessingState): string {
  debugLog(state, 'output', 'Starting output formatting')
  const parts: string[] = []

  // Group lines by type
  const isExportStatement = (line: string) => {
    const trimmed = line.trim()
    return trimmed.startsWith('export *')
      || (trimmed.startsWith('export {') && !trimmed.startsWith('export declare'))
      || (trimmed.startsWith('export type {') && !trimmed.startsWith('export declare type'))
  }

  // Get declarations (everything except bare exports)
  const declarations = state.dtsLines.filter(line => !isExportStatement(line))

  // Process declarations preserving empty lines
  const currentSection: string[] = []
  let lastLineWasEmpty = false

  for (const line of declarations) {
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      if (!lastLineWasEmpty) {
        currentSection.push('')
      }
      lastLineWasEmpty = true
      continue
    }
    lastLineWasEmpty = false
    currentSection.push(line)
  }

  // Add declarations
  if (currentSection.length > 0) {
    debugLog(state, 'output', `Adding ${currentSection.length} declarations`)
    parts.push(currentSection.join('\n'))
  }
  // Deduplicate and add export statements
  const exportLines = new Set([
    ...state.dtsLines.filter(isExportStatement),
    ...state.exportAllStatements,
  ])

  if (exportLines.size > 0) {
    debugLog(state, 'output', `Adding ${exportLines.size} export statements`)
    if (parts.length > 0)
      parts.push('')
    parts.push([...exportLines].join('\n'))
  }

  // Add default exports at the very end
  if (state.defaultExports.size > 0) {
    debugLog(state, 'output', `Adding ${state.defaultExports.size} default exports`)
    if (parts.length > 0)
      parts.push('')
    state.defaultExports.forEach((defaultExport) => {
      debugLog(state, 'default-export', `Adding to output: ${defaultExport}`)
      parts.push(defaultExport)
    })
  }

  const finalOutput = `${parts.join('\n')}\n`
  debugLog(state, 'output', `Final output length: ${finalOutput.length}`)
  return finalOutput
}

/**
 * Format nested properties with proper indentation
 */
export function formatProperties(properties: PropertyInfo[], indent = 2): string {
  return properties.map((prop) => {
    const spaces = ' '.repeat(indent)
    let key = prop.key

    // Check if the key is a valid identifier; if not, quote it
    if (!/^[_$a-z][\w$]*$/i.test(key)) {
      key = `'${key}'`
    }

    if (prop.nested && prop.nested.length > 0) {
      const nestedProps = formatProperties(prop.nested, indent + 2)
      return `${spaces}${key}: {\n${nestedProps}\n${spaces}};`
    }
    return `${spaces}${key}: ${prop.type};`
  }).join('\n')
}
