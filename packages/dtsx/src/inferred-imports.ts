import type { Declaration } from './types'
import { scanIsolatedDeclarations } from './extractor/scanner'
import { functionCount } from './call-signatures'
import { parseImportDetailed } from './processor/imports'

/** Verify callable identities from resolved authored sources, never from names alone. */
export function monomorphicImportFunctions(source: string, imports: ReadonlyMap<string, string>): Set<string> {
  const known = new Set<string>()
  for (const declaration of scanIsolatedDeclarations(source, 'imports.ts', false)) {
    if (declaration.kind !== 'import') continue
    const imported = parseImportDetailed(declaration.text)
    const target = imported && imports.get(imported.source)
    if (!imported || imported.isTypeOnly || !target) continue
    const functions = scanIsolatedDeclarations(target, 'dependency.ts', false).filter(item => item.kind === 'function')
    const eligible = (item: Declaration): boolean => !item.generics && functions.filter(other => other.name === item.name).length === 1 && functionCount(target, item.name) === 1
    for (const binding of imported.namedItems) {
      if (!binding.isTypeOnly && functions.some(item => item.isExported && item.name === binding.originalName && eligible(item))) known.add(binding.name)
    }
    if (imported.defaultName && functions.some(item => item.isDefault && eligible(item))) known.add(imported.defaultName)
  }
  return known
}
