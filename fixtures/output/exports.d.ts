import type { BunPlugin } from 'bun';
import type { SomeOtherType } from '@stacksjs/types';
import { dtsConfig } from './config';
import { generate, something as dts } from './generate';

export { generate, dtsConfig, type BunPlugin }
export type { SomeOtherType };
export type { BunRegisterPlugin } from 'bun';
export { config } from './config'

export * from './extract'
export * from './generate'
export * from './types'
export * from './utils'

export default dts;