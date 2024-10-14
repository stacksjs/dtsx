export interface DtsGenerationOption {
  cwd?: string
  tsconfigPath?: string
  root?: string
  outdir?: string
  keepComments?: boolean
}

export type DtsGenerationOptions = DtsGenerationOption | DtsGenerationOption[]
