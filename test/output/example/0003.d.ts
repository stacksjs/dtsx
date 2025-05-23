import type { PluginBuilder } from 'bun';
import type { UnimportOptions } from 'unimport';
declare function getLoader(path: string): string;
export declare function autoImports(options: Partial<UnimportOptions & { dts: string }>): AutoImportsPlugin;
declare const dtsContent: (await generateTypeDeclarations()
      Bun.write(options.dts ?? './auto-import.d.ts', dtsContent)

      builder.onLoad({ filter: /.*/ }, async (args)) => unknown;
declare interface AutoImportsPlugin {
  name: string
  setup: (builder: PluginBuilder) => Promise<void>
}
export type AutoImportsOptions = UnimportOptions