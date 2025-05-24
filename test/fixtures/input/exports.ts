import { generate, something as dts } from './generate'
import { dtsConfig } from './config'
import type { SomeOtherType } from '@stacksjs/types';
import type { BunPlugin } from 'bun';

export { generate, dtsConfig, type BunPlugin }
export type { SomeOtherType }
export type { BunRegisterPlugin } from 'bun'

export default dts

export { config } from './config'
export * from './extract'
export * from './generate'
export * from './types'
export * from './utils'
