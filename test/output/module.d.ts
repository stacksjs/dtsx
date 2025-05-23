declare interface DtsGenerationConfig {
    customPlugins?: Array<{
      name: string
      transform: (code: string) => string
    }>
  }
declare interface DtsGenerationResult {
    customPluginResults?: Record<string, string>
  }