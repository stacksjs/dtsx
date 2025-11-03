// Regression test for type/interface imports in d.ts files
// When a type or interface uses an imported type, the import should be included in the d.ts file

import type { ParsedPath } from 'node:path'
import { readFileSync } from 'node:fs'

/**
 * Internal type that uses an imported type
 */
type FileInfo = {
  path: ParsedPath
  content: string
}

/**
 * Interface that uses an imported type
 */
interface FileMetadata {
  parsedPath: ParsedPath
  size: number
}

/**
 * Exported interface that uses another interface
 */
export interface FileDetails extends FileMetadata {
  name: string
}

/**
 * Exported function that returns a type using imported types
 */
export function getFileInfo(filePath: string): FileInfo {
  return {
    path: {} as ParsedPath,
    content: readFileSync(filePath, 'utf-8')
  }
}

/**
 * Exported function that uses interface parameter
 */
export function processFile(metadata: FileMetadata): void {
  console.log(metadata)
}

/**
 * Exported type alias that uses imported type
 */
export type PathInfo = ParsedPath & {
  exists: boolean
}
