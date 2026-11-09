import type { BunPlugin } from 'bun';
import { generate } from '@dtsx/dtsx';
import type { DtsGenerationOption } from '@dtsx/dtsx';
export type { DtsGenerationOption };
export declare function dts(options?: DtsGenerationOption): BunPlugin;
export { generate };
export default dts;
