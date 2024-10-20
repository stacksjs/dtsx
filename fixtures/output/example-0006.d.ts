import type { DtsGenerationOption } from '@stacksjs/dtsx'
import type { BunPlugin } from 'bun'
import { generate } from '@stacksjs/dtsx'

export declare function dts(options?: DtsGenerationOption): BunPlugin

export { generate }

export type { DtsGenerationOption }

export default dts
