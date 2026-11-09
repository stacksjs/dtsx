import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const packageDir = join(import.meta.dir, '..')
const manifest: { files: string[] } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))

describe('@dtsx/dtsx package files', () => {
  // Packing fails on a missing `files` entry, and commit builds publish
  // without the native libraries a release adds under native/<platform>/.
  test('every packed path other than the build output exists in the source tree', () => {
    for (const entry of manifest.files.filter(entry => entry !== 'dist'))
      expect(existsSync(join(packageDir, entry)), entry).toBe(true)
  })

  test('ships the native engine directory', () => {
    expect(manifest.files).toContain('native')
  })
})
