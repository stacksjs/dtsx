declare module '@stacksjs/some-module' {
  interface DtsGenerationConfig {
    customPlugins?: Array<{
      name: string
      transform: (code: string) => string
    }>
  }

  interface DtsGenerationResult {
    customPluginResults?: Record<string, string>
  }
}
