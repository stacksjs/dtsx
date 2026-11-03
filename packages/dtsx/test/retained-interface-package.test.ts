import { test } from 'bun:test'
import { packedRetainedGraph } from './helpers/retained-package'

for (const producer of ['core', 'bun-plugin'] as const) {
  test(`${producer} retains an imported base of a local interface used by an exported value in a normal strict packed consumer`, async () => {
    await packedRetainedGraph(producer)
  })
}

for (const variant of ['renamed', 'namespace', 'transitive', 'member', 'unreferenced'] as const) {
  for (const producer of ['core', 'bun-plugin'] as const) {
    const behavior = variant === 'unreferenced' ? 'prunes unreachable interface imports alongside required imports' : `retains ${variant} local interface imports without retaining unused bindings`
    test(`${producer} ${behavior}`, async () => {
      await packedRetainedGraph(producer, variant)
    })
  }
}

for (const variant of ['defaultInterface', 'defaultVariable', 'defaultFunction', 'asyncDefaultFunction', 'unreachableFunction', 'unreachableAsyncFunction', 'retainedFunctionWithOverloads', 'privateOverloadedFunction', 'privateImplementationOnly', 'exportedImplementationOnly', 'retainedFunctionReturn'] as const) {
  for (const producer of ['core', 'bun-plugin'] as const) {
    test(`${producer} preserves ${variant} through retained declaration graph imports`, async () => {
      await packedRetainedGraph(producer, variant)
    })
  }
}
