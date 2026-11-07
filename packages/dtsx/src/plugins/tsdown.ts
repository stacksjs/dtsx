import type { DtsGenerationConfig } from '../types'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { generate } from '../generator'

/** Declaration generation options; tsdown owns entries, output names and cleaning. */
export type TsdownDtsOptions = Omit<Partial<DtsGenerationConfig>,
'entrypoints' | 'outdir' | 'bundle' | 'bundleOutput' | 'clean' | 'dryRun' | 'outputStructure' | 'declarationMap'>

interface ResolvedBuild {
  cwd?: string
  root: string
  outDir?: string
  format: string
}

interface OutputFile {
  type: string
  fileName: string
  isEntry?: boolean
  facadeModuleId?: string | null
}

/** Structural host contract keeps the core SDK independent of tsdown and Rolldown. */
export interface TsdownDeclarationPlugin {
  name: string
  tsdownConfig: () => { dts: false }
  tsdownConfigResolved: (config: ResolvedBuild) => void
  generateBundle: (
    this: { emitFile: (asset: { type: 'asset', fileName: string, source: string }) => string },
    output: { dir?: string, format?: string },
    bundle: Record<string, OutputFile>,
  ) => Promise<void>
}

/** Use in tsdown's plugins array. No TypeScript compiler or tsdown runtime import. */
export function dts(options: TsdownDtsOptions = {}): TsdownDeclarationPlugin {
  if (Reflect.get(options, 'declarationMap')) throw new Error('dtsx: bundled declaration maps are not supported')
  const builds = new Map<string, ResolvedBuild>()
  const key = (directory: string, format: string): string => `${resolve(directory)}\0${format}`

  return {
    name: 'dtsx',
    tsdownConfig: () => ({ dts: false }),
    tsdownConfigResolved(config) {
      builds.set(key(resolve(config.cwd ?? process.cwd(), config.outDir ?? 'dist'), config.format), config)
    },
    async generateBundle(output, bundle) {
      const config = builds.get(key(output.dir ?? 'dist', output.format ?? 'es'))
      if (!config) throw new Error('dtsx: expected a resolved tsdown build before generating declarations')
      const cwd = await realpath(resolve(options.cwd ?? config.cwd ?? process.cwd()))
      const root = await realpath(resolve(cwd, options.root ?? config.root))
      const directory = await mkdtemp(join(tmpdir(), 'dtsx-tsdown-'))
      try {
        // The final entry chunks include aliases, nesting and format extensions.
        // Rolldown writes these assets with the JavaScript, after its own clean.
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk' || !chunk.isEntry || !chunk.facadeModuleId) continue
          const extension = chunk.fileName.endsWith('.cjs') ? '.d.cts'
            : chunk.fileName.endsWith('.mjs') ? '.d.mts' : '.d.ts'
          const filename = chunk.fileName.replace(/\.(?:c|m)?js$/, extension)
          if (filename === chunk.fileName) throw new Error(`dtsx: unsupported tsdown JavaScript output ${chunk.fileName}`)
          const result = await generate({
            ...options,
            cwd,
            root,
            entrypoints: [chunk.facadeModuleId],
            outdir: directory,
            bundle: true,
            bundleOutput: filename,
            clean: false,
            dryRun: false,
            outputStructure: 'mirror',
            declarationMap: false,
            moduleSpecifierMode: options.moduleSpecifierMode ?? 'node',
          })
          if (result.filesFailed) throw new Error(`dtsx: declaration generation failed for ${chunk.facadeModuleId}`)
          this.emitFile({ type: 'asset', fileName: filename, source: await readFile(join(directory, filename), 'utf8') })
        }
      }
      finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  }
}

export default dts
