import type { Declaration } from '../types'
import { isIdentChar, isIdentStart } from '../lexical'
import { processVariableDeclaration } from './declarations'
import { extractAllImportedItems } from './imports'

/** The same declaration reference analysis serves import pruning and graph planning. */
export function analyzeDeclarationImportUsage(declarations: readonly Declaration[]): {
  usedItems: Set<string>
  referenceText: string
} {
  const names = new Set<string>()
  const parts: string[] = []
  for (const declaration of declarations) {
    if (declaration.kind === 'import') {
      for (const item of extractAllImportedItems(declaration.text)) names.add(item)
    }
    else if (declaration.kind !== 'unknown') {
      parts.push(declaration.text)
      if (declaration.kind === 'variable') {
        if (declaration.typeAnnotation) parts.push(declaration.typeAnnotation)
        else if (declaration.isExported && declaration.value) parts.push(processVariableDeclaration(declaration, false))
      }
    }
  }
  const referenceText = parts.join('\n')
  const usedItems = new Set<string>()
  for (let index = 0; index < referenceText.length; ) {
    if (!isIdentStart(referenceText.charCodeAt(index))) { index++; continue }
    const start = index++
    while (index < referenceText.length && isIdentChar(referenceText.charCodeAt(index))) index++
    const word = referenceText.slice(start, index)
    if (names.has(word)) usedItems.add(word)
  }
  return { usedItems, referenceText }
}
