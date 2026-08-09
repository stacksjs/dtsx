/**
 * A call with an explicit type argument must not be read as a comparison.
 *
 *   export const Review = lazyModel<typeof import('./Review').default>('Review')
 *
 * `lazyModel < T > ('Review')` is also a valid parse — a chain of relational
 * operators — and dtsx took it, so the initializer's inferred type came out as
 * `boolean`. TypeScript resolves the same ambiguity the other way inside a
 * `.ts` file: an identifier followed by a balanced `<...>` and then `(` is a
 * generic call.
 *
 * The cost of getting it wrong is not local. Stacks declares every model in its
 * ORM registry this way, so the published `@stacksjs/orm` typed all seventy-two
 * of them as `boolean`. Consumers didn't see `boolean` — they saw what it
 * decays into two layers down: `NewModelData<typeof Review>` became `never`,
 * and a `never` parameter accepts no argument and cannot be cast into
 * accepting one, so the error named neither the model nor the package. It also
 * reached auth as `Property 'find' does not exist on type 'boolean'`.
 *
 * The declarations stayed syntactically valid throughout, so nothing in the
 * build, the publish, or `tsc` on the package itself objected.
 */

import { describe, expect, it } from 'bun:test'
import { processCode } from './test-utils'

describe('a generic call is a call, not a comparison', () => {
  it('infers from the callee rather than collapsing to boolean', async () => {
    const dts = await processCode(
      `import { lazyModel } from '@stacksjs/orm'\n`
      + `export const Review = lazyModel<typeof import('../models/Review').default>('Review')\n`,
    )

    expect(dts).not.toContain('boolean')
    expect(dts).toContain('ReturnType<typeof lazyModel<')
  })

  it('handles a plain type argument', async () => {
    const dts = await processCode(
      `import { make } from './make'\nexport const x = make<string>('x')\n`,
    )

    expect(dts).not.toContain('boolean')
    expect(dts).toContain('ReturnType<typeof make<string>>')
  })

  it('handles several type arguments', async () => {
    const dts = await processCode(
      `import { pair } from './pair'\nexport const p = pair<string, number>('a', 1)\n`,
    )

    expect(dts).not.toContain('boolean')
    expect(dts).toContain('ReturnType<typeof pair<string, number>>')
  })

  it('handles a nested type argument', async () => {
    const dts = await processCode(
      `import { make } from './make'\nexport const m = make<Map<string, number[]>>('m')\n`,
    )

    expect(dts).not.toContain('boolean')
    expect(dts).toContain('Map<string, number[]>')
  })

  it('still reads a real comparison as boolean', async () => {
    // No balanced `<...>` followed by a call, so nothing here is a generic
    // call and the inference that this test guards must not fire.
    const dts = await processCode(`export const isBigger = 3 > 2\n`)

    expect(dts).toContain('boolean')
  })
})
