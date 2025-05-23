import { Config } from './types';
export declare function loadConfig<T>({
  name,
  cwd,
  defaultConfig,
  endpoint,
  headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
}: Config<T>): Promise<T>;
export * from './types';
export * from './utils';