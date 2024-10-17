/**
 * DtsGenerationConfig
 *
 * This is the configuration object for the DTS generation process.
 */
export interface DtsGenerationConfig {
  cwd: string
  root: string
  file: string
  outdir: string
  keepComments: boolean
  clean: boolean
  tsconfigPath: string
}

/**
 * DtsGenerationOption
 *
 * This is the configuration object for the DTS generation process.
 */
export type DtsGenerationOption = Partial<DtsGenerationConfig>

/**
 * DtsGenerationOptions
 *
 * This is the configuration object for the DTS generation process.
 */
export type DtsGenerationOptions = DtsGenerationOption | DtsGenerationOption[]
