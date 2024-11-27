import type { BunPlugin } from 'bun';
import type { DtsGenerationOption } from '@stacksjs/dtsx';
import { generate } from '@stacksjs/dtsx';

export type { DtsGenerationOption }
export declare function dts(options?: DtsGenerationOption): BunPlugin;

export { generate }

export default dts;