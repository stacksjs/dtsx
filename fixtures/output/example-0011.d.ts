import type { DtsGenerationConfig } from './types'

export declare function writeToFile(filePath: string, content: string): Promise<void>

export declare function getAllTypeScriptFiles(directory?: string): Promise<string[]>

export declare function checkIsolatedDeclarations(options?: DtsGenerationConfig): Promise<boolean>

export declare function formatDeclarations(declarations: string): string

export declare function formatComment(comment: string): string

export declare function deepMerge<T extends object>(target: T, ...sources: Array<Partial<T>>): T
