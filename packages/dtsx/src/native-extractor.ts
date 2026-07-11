import type { Declaration } from './types'
import type { AsyncParseConfig, CachedSourceFile } from './source-cache'
import { batchParseSourceFiles, clearSourceFileCache as clearSourceCache, getPendingParseCount, getSourceFile, getSourceFileAsync, getSourceFileCacheSize, shouldUseAsyncParsing } from './source-cache'
import { clearDeclarationCache, extractDeclarations as scanDeclarations } from './extractor/extract'

export type { AsyncParseConfig, CachedSourceFile }
export { batchParseSourceFiles, getPendingParseCount, getSourceFile, getSourceFileAsync, getSourceFileCacheSize, shouldUseAsyncParsing }

export function clearSourceFileCache(): void {
  clearSourceCache()
  clearDeclarationCache()
}

export function extractDeclarations(
  sourceCode: string,
  filePath: string,
  keepComments = true,
  isolatedDeclarations = false,
): Declaration[] {
  return scanDeclarations(sourceCode, filePath, keepComments, isolatedDeclarations)
}

export async function extractDeclarationsAsync(
  sourceCode: string,
  filePath: string,
  keepComments = true,
  config: AsyncParseConfig = {},
): Promise<Declaration[]> {
  await getSourceFileAsync(filePath, sourceCode, config)
  return extractDeclarations(sourceCode, filePath, keepComments)
}

export async function batchExtractDeclarations(
  files: Array<{ filePath: string, sourceCode: string, keepComments?: boolean }>,
  config: AsyncParseConfig & { concurrency?: number } = {},
): Promise<Map<string, Declaration[]>> {
  const concurrency = config.concurrency ?? 4
  const results = new Map<string, Declaration[]>()
  for (let index = 0; index < files.length; index += concurrency) {
    const batch = files.slice(index, index + concurrency)
    const generated = await Promise.all(batch.map(async file => ({
      path: file.filePath,
      declarations: await extractDeclarationsAsync(file.sourceCode, file.filePath, file.keepComments, config),
    })))
    for (const item of generated) results.set(item.path, item.declarations)
  }
  return results
}
