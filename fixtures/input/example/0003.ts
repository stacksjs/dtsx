import type { PluginBuilder } from 'bun'
import type { UnimportOptions } from 'unimport'

function getLoader(path: string): string {
  return path.endsWith('ts')
    ? 'ts'
    : path.endsWith('js')
      ? 'js'
      : path.endsWith('tsx')
        ? 'tsx'
        : 'jsx'
}

interface AutoImportsPlugin {
  name: string
  setup: (builder: PluginBuilder) => Promise<void>
}

export function autoImports(options: Partial<UnimportOptions & { dts: string }>): AutoImportsPlugin {
  return {
    name: 'bun-plugin-auto-imports',

    async setup(builder: PluginBuilder): Promise<void> {
      const { createUnimport } = await import('unimport')
      const { injectImports, generateTypeDeclarations } = createUnimport({
        ...options,
        dts: undefined,
      } as UnimportOptions)

      const dtsContent = await generateTypeDeclarations()
      Bun.write(options.dts ?? './auto-import.d.ts', dtsContent)

      builder.onLoad({ filter: /.*/ }, async (args) => {
        const fileContent = await Bun.file(args.path).text()
        const transformedFileContent = await injectImports(fileContent)

        return {
          contents: transformedFileContent.code,
          loader: getLoader(args.path),
        }
      })
    },
  }
}

export type AutoImportsOptions = UnimportOptions

export default autoImports
