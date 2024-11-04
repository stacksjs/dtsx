import { dtsConfig } from './config';
import { generate, something as dts } from './generate';
export { generate, dtsConfig, type BunPlugin };
export type { SomeOtherType }
;
export { config } from './config';
export * from './extract';
export * from './generate';
export * from './types';
export * from './utils';
export default dts;
