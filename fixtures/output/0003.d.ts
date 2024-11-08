import type { PluginBuilder } from 'bun';
import type { UnimportOptions } from 'unimport';

declare function getLoader(path: string): string;
declare interface AutoImportsPlugin {
  name: string
  setup: (builder: PluginBuilder) => Promise<void>
}
export declare function autoImports(options: Partial<UnimportOptions & { dts: string }>): AutoImportsPlugin;
export declare type AutoImportsOptions = UnimportOptions

export default autoImports;