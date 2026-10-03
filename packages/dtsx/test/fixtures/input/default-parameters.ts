/**
 * Getters and setters in an object literal are accessors, not
 * function-typed properties (#3093).
 */
export const ENV = {
  get TRACE(): boolean { return process.env.PICKIER_TRACE === '1' },
  get NAME(): string { return 'dtsx' },
  set NAME(value: string) {},
  level: 1,
}

// A default on an object-typed parameter makes it optional, and the
// initializer is dropped.
export function resilient(config: { sentryDsn?: string, bugsnagApiKey?: string, services?: string[] } = {}): void {}

export const createClient = (config: {
  baseUrl?: string
  timeout?: number
} = {}, retries = 3, name = 'client', verbose = false): void => {}

export const presets = {
  resilient: (config: {
    sentryDsn?: string
    bugsnagApiKey?: string
    services?: string[]
  } = {}): string => 'resilient',
  load: async (options: { cache?: boolean } = {}, attempts = 3): Promise<number> => attempts,
  configure(config: {
    host?: string
    port?: number
  } = {}): void {},
  withCallback: (count: number = 1, done: () => void = () => {}): number => count,
}

export const format = function (value: number = 0, unit = 'px'): string {
  return `${value}${unit}`
}

export class ErrorHandler {
  resilient(config: { sentryDsn?: string, bugsnagApiKey?: string } = {}): void {}
}
