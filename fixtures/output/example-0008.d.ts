import type { DtsGenerationConfig, DtsGenerationOption } from './types'

export declare function generateDeclarationsFromFiles(options?: DtsGenerationConfig): Promise<void>

export declare function generate(options?: DtsGenerationOption): Promise<void>
