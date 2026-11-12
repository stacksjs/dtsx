import { functionCount } from './call-signatures'
import { scanIsolatedDeclarations } from './extractor/scanner'
import { parseImportDetailed } from './processor/imports'

/** Verify callable identities from resolved authored sources, never from names alone. */
export function monomorphicImportFunctions(source: string, imports: ReadonlyMap<string, string>): Set<string> {
  const known = new Set<string>()
  for (const declaration of scanIsolatedDeclarations(source, 'imports.ts', false)) {
    if (declaration.kind !== 'import') continue
    const imported = parseImportDetailed(declaration.text)
    const target = imported && imports.get(imported.source)
    if (!imported || imported.isTypeOnly || !target) continue
    const functions = monomorphicExportedFunctions(target)
    for (const binding of imported.namedItems) {
      if (!binding.isTypeOnly && functions.some(item => item.name === binding.originalName)) known.add(binding.name)
    }
    if (imported.defaultName && functions.some(item => item.isDefault)) known.add(imported.defaultName)
  }
  return known
}

/** The identities whose call results can safely be represented by ReturnType. */
export function monomorphicExportedFunctions(source: string): Array<{ name: string, isDefault: boolean }> {
  const functions = scanIsolatedDeclarations(source, 'dependency.ts', false).filter(item => item.kind === 'function')
  return functions.filter(item => item.isExported && !item.generics && functions.filter(other => other.name === item.name).length === 1 && functionCount(source, item.name) === 1)
    .map(item => ({ name: item.name, isDefault: Boolean(item.isDefault) }))
    .sort((left, right) => left.name.localeCompare(right.name))
}
