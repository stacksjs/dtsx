import type { DtsGenerationConfig } from '@stacksjs/dtsx'

interface Options<T> {
  name: string
  cwd?: string
  defaultConfig: T
}

export declare function loadConfig<T extends Record<string, unknown>>({ name, cwd, defaultConfig }: Options<T>): Promise<T>

export declare const config: DtsGenerationConfig
