import type { DtsGenerationConfig } from './types'

export declare function loadConfig<T extends Record<string, unknown>>({ name, cwd, defaultConfig }: Options<T>): Promise<T>

export declare const config: DtsGenerationConfig
