export declare function loadConfig<T extends Record<string, unknown>>({ name, cwd, defaultConfig }: ConfigOptions<T>): Promise<T>;
export declare interface ConfigOptions<T> {
  name: string
  cwd?: string
  defaultConfig: T
}