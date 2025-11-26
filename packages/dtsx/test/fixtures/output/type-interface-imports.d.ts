import type { ParsedPath } from 'node:path';
/**
 * Exported function that returns a type using imported types
 */
export declare function getFileInfo(filePath: string): FileInfo;
/**
 * Exported function that uses interface parameter
 */
export declare function processFile(metadata: FileMetadata): void;
/**
 * Interface that uses an imported type
 */
declare interface FileMetadata {
  parsedPath: ParsedPath
  size: number
}
/**
 * Exported interface that uses another interface
 */
export declare interface FileDetails extends FileMetadata {
  name: string
}
/**
 * Internal type that uses an imported type
 */
declare type FileInfo = {
  path: ParsedPath
  content: string
}
/**
 * Exported type alias that uses imported type
 */
export type PathInfo = ParsedPath & {
  exists: boolean
}
