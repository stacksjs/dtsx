import type { ModuleResolver } from './module-graph'
import type { ModuleReference } from './module-references'
import { readTextFile } from './compat'
import { extractDeclarations } from './extractor'
import { scanModuleReferences } from './module-references'
import { analyzeDeclarationImportUsage } from './processor/import-usage'
import { extractAllImportedItems } from './processor/imports'

/** Quoted ambient modules in an external module augment an existing module. */
export function scanModuleAugmentations(source: string): string[] {
  if (!source.includes('declare') || !source.includes('module')) return []
  return scanModuleReferences(source).filter(reference => reference.category === 'augmentation').map(reference => reference.specifier)
}

interface Edge { specifier: string, target: string, import: boolean }
interface Node { edges: Edge[], declarations: Set<string>, augmentations: Set<string> }

function closure(start: string, edges: (file: string) => Iterable<string>): Set<string> {
  const visited = new Set([start])
  for (const file of visited) {
    for (const target of edges(file)) visited.add(target)
  }
  return visited
}

/**
 * Find original import paths that activate augmentations of declaration-reachable
 * local modules. Retain the paths, not unused value bindings. This analysis
 * never publishes outputs or invokes a native or TypeScript emitter.
 * The analysis universe may include excluded sources; delivery policy still
 * decides whether a required path can actually be published by the caller.
 */
export async function planAugmentationImports(
  files: readonly string[],
  resolveModule: ModuleResolver,
  isolatedDeclarations = false,
  sourceSnapshots?: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const sources = new Map<string, string>()
  const augmentations = new Map<string, string[]>()
  for (const file of files) {
    const source = sourceSnapshots?.get(file) ?? await readTextFile(file)
    sources.set(file, source)
    const specifiers = scanModuleAugmentations(source)
    if (specifiers.length) augmentations.set(file, specifiers)
  }
  const required = new Map<string, Set<string>>()
  if (augmentations.size === 0) return required

  const nodes = new Map<string, Node>()
  for (const [file, source] of sources) {
    const declarations = extractDeclarations(source, file, false, isolatedDeclarations)
    const usage = analyzeDeclarationImportUsage(declarations)
    const node: Node = { edges: [], declarations: new Set(), augmentations: new Set() }
    const add = (reference: ModuleReference, isImport: boolean, used: boolean): void => {
      const target = resolveModule(reference.specifier, file).resolved
      if (!target || !sources.has(target)) return
      node.edges.push({ specifier: reference.specifier, target, import: isImport })
      if (used) node.declarations.add(target)
    }
    for (const declaration of declarations) {
      if (declaration.kind !== 'import') continue
      const used = declaration.isSideEffect || extractAllImportedItems(declaration.text).some(item => usage.usedItems.has(item))
      for (const reference of scanModuleReferences(declaration.text)) add(reference, true, !!used)
    }
    for (const reference of scanModuleReferences(usage.referenceText)) add(reference, false, true)
    for (const specifier of augmentations.get(file) ?? []) {
      const target = resolveModule(specifier, file).resolved
      if (target && sources.has(target)) {
        node.augmentations.add(target)
        node.declarations.add(target)
      }
    }
    nodes.set(file, node)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [file, node] of nodes) {
      const visible = closure(file, current => nodes.get(current)?.declarations ?? [])
      for (const [provider, augmentation] of nodes) {
        if (visible.has(provider) || !augmentation.augmentations.size || ![...augmentation.augmentations].some(target => visible.has(target))) continue
        // Find a shortest original route. A cycle through an unrelated import
        // must not retain that import merely because it can return here.
        const pending = [file]
        const parents = new Map<string, { from: string, edge: Edge }>()
        const visited = new Set([file])
        for (const current of pending) {
          if (current === provider) break
          for (const edge of nodes.get(current)!.edges) {
            if (visited.has(edge.target)) continue
            visited.add(edge.target)
            parents.set(edge.target, { from: current, edge })
            pending.push(edge.target)
          }
        }
        if (!parents.has(provider)) continue
        for (let target = provider; target !== file; ) {
          const { from, edge } = parents.get(target)!
          const owner = nodes.get(from)!
          if (edge.import) {
            let imports = required.get(from)
            if (!imports) { imports = new Set(); required.set(from, imports) }
            imports.add(edge.specifier)
          }
          if (!owner.declarations.has(target)) { owner.declarations.add(target); changed = true }
          target = from
        }
      }
    }
  }
  return required
}
