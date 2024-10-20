import type { DtsGenerationOption } from '@stacksjs/dtsx'
import type { BunPlugin } from 'bun'
import process from 'node:process'
import { generate } from '@stacksjs/dtsx'

export function dts(options?: DtsGenerationOption): BunPlugin {
  return {
    name: 'bun-plugin-dtsx',

    async setup(build) {
      const cwd = options?.cwd ?? process.cwd()
      const root = options?.root ?? build.config.root
      const entrypoints = options?.entrypoints ?? build.config.entrypoints
      const outdir = options?.outdir ?? build.config.outdir
      const keepComments = options?.keepComments ?? true
      const clean = options?.clean ?? false
      const tsconfigPath = options?.tsconfigPath ?? './tsconfig.json'

      await generate({
        ...options,
        cwd,
        root,
        entrypoints,
        outdir,
        keepComments,
        clean,
        tsconfigPath,
      })
    },
  }
}

export { generate }

export type { DtsGenerationOption }

export default dts
