export declare async function loadConfig<T extends Record<string, unknown>>({ name, cwd, defaultConfig }: ConfigOptions<T>): Promise<T>;
declare const c: unknown;
declare const configPath: unknown;
export declare interface ConfigOptions<T> {
  name: string
  cwd?: string
  defaultConfig: T
}