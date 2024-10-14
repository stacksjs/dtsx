export interface DtsGenerationOption {
  cwd?: string
  tsconfigPath?: string
  root?: string
  outdir?: string
}

export type DtsGenerationOptions = DtsGenerationOption | DtsGenerationOption[]
