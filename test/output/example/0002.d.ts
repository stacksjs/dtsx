import type { DtsGenerationOption } from '@stacksjs/dtsx';
import type { BunPlugin } from 'bun';
export declare function dts(options?: DtsGenerationOption): BunPlugin;
declare const cwd: unknown;
declare const root: unknown;
declare const entrypoints: unknown;
declare const outdir: unknown;
// const keepComments = options?.keepComments ?? true
declare const clean: unknown;
declare const tsconfigPath: unknown;
export type { DtsGenerationOption }