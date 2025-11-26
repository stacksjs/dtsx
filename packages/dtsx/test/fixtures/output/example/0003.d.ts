import type { PluginBuilder } from 'bun';
import type { UnimportOptions } from 'unimport';
export declare function autoImports(options: Partial<UnimportOptions & { dts: string }>): AutoImportsPlugin;
declare interface AutoImportsPlugin {
  name: string
  setup: (builder: PluginBuilder) => Promise<void>
}
export type AutoImportsOptions = UnimportOptions;
export default autoImports;
