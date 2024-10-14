export interface DtsGenerationConfig {
  cwd: string
  root: string
  outdir: string
  keepComments: boolean
  clean: boolean
}

export type DtsGenerationOption = Partial<DtsGenerationConfig>

export type DtsGenerationOptions = DtsGenerationOption | DtsGenerationOption[]
