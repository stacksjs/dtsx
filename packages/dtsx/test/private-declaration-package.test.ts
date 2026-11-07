import { test } from 'bun:test'
import { privatePackageFixtures } from './helpers/private-fixtures'
import { packedPrivateContract } from './helpers/private-package'

for (const producer of ['core', 'bun-plugin', 'native'] as const) {
  for (const [name, fixture] of Object.entries(privatePackageFixtures)) {
    test(`${producer} preserves ${name} in a strict normally installed package`, () => packedPrivateContract(producer, fixture))
  }
}
