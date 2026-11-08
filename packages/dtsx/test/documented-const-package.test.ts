import { expect, test } from 'bun:test'
import { checkDeclarationPackage } from './helpers/declaration-package'

// #3141: comments attach to the authored property, before its readonly modifier.
const source = `export const APP_CONSTANTS = {
  /** Default port number */
  DEFAULT_PORT: 3000,
  /** Maximum retry attempts */
  MAX_RETRIES: 3,
  /**
   * Timeout duration in milliseconds
   * @default 5000
   */
  TIMEOUT: 5000,
  /** Application version */
  VERSION: '1.0.0'
} as const`

for (const producer of ['core', 'bun-plugin', 'native'] as const) {
  test(`${producer} preserves documented readonly properties in a strict installed package`, async () => {
    await checkDeclarationPackage(producer, {
      source,
      positive: `const port: 3000 = api.APP_CONSTANTS.DEFAULT_PORT
const retries: 3 = api.APP_CONSTANTS.MAX_RETRIES
const timeout: 5000 = api.APP_CONSTANTS.TIMEOUT
const version: '1.0.0' = api.APP_CONSTANTS.VERSION`,
      negatives: [
        ...['DEFAULT_PORT', 'MAX_RETRIES', 'TIMEOUT', 'VERSION'].map(key => ({ code: 2540, content: `api.APP_CONSTANTS.${key} = api.APP_CONSTANTS.${key}` })),
        { code: 2322, content: 'const invalid: keyof typeof api.APP_CONSTANTS = "readonly"' },
        { code: 2322, content: 'const invalid: string = api.APP_CONSTANTS.TIMEOUT' },
      ],
      inspect(declaration) {
        expect(declaration).toMatch(/\/\*\* Default port number \*\/\s+readonly DEFAULT_PORT: 3000/)
        expect(declaration).toMatch(/\/\*\* Maximum retry attempts \*\/\s+readonly MAX_RETRIES: 3/)
        expect(declaration).toMatch(/\/\*\*\s+\* Timeout duration in milliseconds\s+\* @default 5000\s+\*\/\s+readonly TIMEOUT: 5000/)
        expect(declaration).toMatch(/\/\*\* Application version \*\/\s+readonly VERSION: '1.0.0'/)
      },
    })
  }, 30_000)
}
