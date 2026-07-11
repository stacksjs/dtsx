import { hashContent } from './extractor/hash'

export interface CachedSourceFile {
  fileName: string
  text: string
}

export interface AsyncParseConfig {
  asyncThreshold?: number
  chunkSize?: number
  yieldInterval?: number
}

const MAX_CACHE_SIZE = 100
const cache = new Map<string, { file: CachedSourceFile, hash: number | bigint }>()
const pending = new Map<string, Promise<CachedSourceFile>>()

function store(filePath: string, sourceCode: string, hash: number | bigint): CachedSourceFile {
  const file = { fileName: filePath, text: sourceCode }
  cache.delete(filePath)
  cache.set(filePath, { file, hash })
  while (cache.size > MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return file
}

export function getSourceFile(filePath: string, sourceCode: string, contentHash: number | bigint = hashContent(sourceCode)): CachedSourceFile {
  const cached = cache.get(filePath)
  if (cached?.hash === contentHash) {
    cache.delete(filePath)
    cache.set(filePath, cached)
    return cached.file
  }
  return store(filePath, sourceCode, contentHash)
}

export async function getSourceFileAsync(filePath: string, sourceCode: string, config: AsyncParseConfig = {}): Promise<CachedSourceFile> {
  const contentHash = hashContent(sourceCode)
  const cached = cache.get(filePath)
  if (cached?.hash === contentHash) return getSourceFile(filePath, sourceCode, contentHash)
  const active = pending.get(filePath)
  if (active) return active

  const task = Promise.resolve().then(async () => {
    try {
      if (sourceCode.length >= (config.asyncThreshold ?? 100000)) {
        await new Promise<void>(resolvePromise => setTimeout(resolvePromise, config.yieldInterval ?? 0))
      }
      return store(filePath, sourceCode, contentHash)
    }
    finally {
      pending.delete(filePath)
    }
  })
  pending.set(filePath, task)
  return task
}

export async function batchParseSourceFiles(
  files: Array<{ filePath: string, sourceCode: string }>,
  config: AsyncParseConfig & { concurrency?: number } = {},
): Promise<Map<string, CachedSourceFile>> {
  const results = new Map<string, CachedSourceFile>()
  const concurrency = config.concurrency ?? 4
  for (let index = 0; index < files.length; index += concurrency) {
    const batch = await Promise.all(files.slice(index, index + concurrency).map(async item => ({
      path: item.filePath,
      file: await getSourceFileAsync(item.filePath, item.sourceCode, config),
    })))
    for (const item of batch) results.set(item.path, item.file)
  }
  return results
}

export function clearSourceFileCache(): void { cache.clear() }
export function getSourceFileCacheSize(): number { return cache.size }
export function getPendingParseCount(): number { return pending.size }
export function shouldUseAsyncParsing(sourceCode: string, config: AsyncParseConfig = {}): boolean {
  return sourceCode.length >= (config.asyncThreshold ?? 100000)
}
