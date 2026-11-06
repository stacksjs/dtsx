import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processSource } from '../src/process-source'
import * as native from '../../zig-dtsx/src/index'
import { isAvailable, runTsc } from './helpers/tsc'

// Exercise both real source emitters. Normal packed API/privacy qualification
// and the wider issue #3138 frontier remain separate required gates.
for (const producer of [
  { name: 'core', emit: (source: string) => processSource(source, 'brand.ts') },
  { name: 'native', emit: (source: string) => native.processSource(source) },
]) {
  test(`${producer.name} retains a private ambient symbol required by an exported brand`, async () => {
    expect(isAvailable).toBe(true)
    if (producer.name === 'native') expect(native.ZIG_AVAILABLE).toBe(true)
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-ambient-brand-'))
    try {
      const source = `declare const __brand: unique symbol
declare const unusedBrand: unique symbol
export type Id = string & { readonly [__brand]: 'id' }
export declare function createId(value: string): Id
`
      await writeFile(join(directory, 'authored.ts'), source)
      await writeFile(join(directory, 'consumer.ts'), "import { createId } from './authored'\nconst value: string = createId('id')\nexport { value }\n")
      const compilerOptions = { strict: true, skipLibCheck: false, types: [], module: 'Preserve', moduleResolution: 'Bundler', noEmit: true }
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['consumer.ts'] }))
      const authored = runTsc(directory, ['--project', 'tsconfig.json'])
      expect(authored.ok, authored.output).toBe(true)
      const output = producer.emit(source)
      expect(output).toContain('declare const __brand: unique symbol;')
      expect(output).not.toContain('unusedBrand')
      await writeFile(join(directory, 'generated.d.ts'), output)
      await writeFile(join(directory, 'consumer.ts'), "import { createId } from './generated'\nconst value: string = createId('id')\nexport { value }\n")
      const generated = runTsc(directory, ['--project', 'tsconfig.json'])
      expect(generated.ok, generated.output).toBe(true)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
}
