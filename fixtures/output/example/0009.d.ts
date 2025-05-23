import type { Config } from './types';

export declare function loadConfig<T>({
  name,
  cwd,
  defaultConfig,
  endpoint,
  headers,
}: Config<T>): Promise<T>;

export * from './types'
export * from './utils'