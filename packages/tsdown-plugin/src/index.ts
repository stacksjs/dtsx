import { dts } from '@dtsx/dtsx/tsdown'

export type { DtsGenerationOption } from '@dtsx/dtsx'
export type { TsdownDeclarationPlugin, TsdownDtsOptions } from '@dtsx/dtsx/tsdown'

/**
 * A tsdown plugin that writes declarations with dtsx instead of tsdown's own
 * `dts` step. tsdown keeps ownership of entries, output names and cleaning.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'tsdown'
 * import { dts } from '@dtsx/tsdown'
 *
 * export default defineConfig({ entry: ['src/index.ts'], plugins: [dts()] })
 * ```
 */
export { dts }
export default dts
