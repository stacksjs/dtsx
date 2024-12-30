# Configuration

`dtsx` can be configured with the following options:

```typescript
// dts.config.ts (or dts.config.js)
import type { DtsGenerationOptions } from '@stacksjs/dtsx'

const options: DtsGenerationOptions = {
  /**
   * The current working directory for the operation.
   * @default './'
   * @type {string}
   * @example
   * cwd: './'
   */
  cwd: './',

  /**
   * The root directory of the source files.
   * @default './src'
   * @type {string}
   * @example
   * root: './src'
   */
  root: './src',

  /**
   * The entry points for generating the declaration files.
   * Supports glob patterns for flexible selection.
   * @default ['**/*.ts']
   * @type {string[]}
   * @example
   * entrypoints: ['**/*.ts']
   */
  entrypoints: ['**/*.ts'],

  /**
   * The output directory for the generated declaration files.
   * @default './dist'
   * @type {string}
   * @example
   * outdir: './dist'
   */
  outdir: './dist',

  /**
   * Whether to clean the output directory before generating new files.
   * @default false
   * @type {boolean}
   * @example
   * clean: true
   */
  clean: true,

  /**
   * Whether to print detailed logs to the console.
   * @default false
   * @type {boolean}
   * @example
   * verbose: true
   */
  verbose: true,

  // Additional options to be added later:
  // /**
  //  * Whether to preserve comments in the generated files.
  //  * @default false
  //  * @type {boolean}
  //  * @example
  //  * keepComments: true
  //  */
  // keepComments: true, // coming soon
};

export default options
```
