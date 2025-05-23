import type { Config } from './types';
export declare async function loadConfig<T>({
  name, cwd, defaultConfig, endpoint, headers = {
    'Accept': 'application/json', 'Content-Type': 'application/json', }, }: Config<T>): Promise<T>;
// back 3 times to get out of node_modules into the root directory, assuming the config is in the root directory
declare const configPath: unknown;
declare const response: unknown;
declare const loadedConfig: unknown;