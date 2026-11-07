import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processSource } from '../src/process-source'
import * as native from '../../zig-dtsx/src/index'
import { isAvailable, runTsc } from './helpers/tsc'

for (const producer of [
  { name: 'core', emit: (source: string) => processSource(source, 'index.ts') },
  { name: 'native', emit: (source: string) => native.processSource(source) },
]) {
  for (const scenario of [
    { name: 'ordinary', binding: 'Options', statement: "import Options = require('./options.cjs')" },
    { name: 'type-only with comments', binding: 'Options', statement: "import /* binding */ type Options /* equals */ = require( /* target */ './options.cjs' /* close */ )" },
    { name: 'a binding named type', binding: 'type', statement: "import type = require('./options.cjs')" },
  ]) {
    test(`${producer.name} retains ${scenario.name} import-equals and prunes an unused binding`, async () => {
      expect(isAvailable).toBe(true)
      if (producer.name === 'native') expect(native.ZIG_AVAILABLE).toBe(true)
      const directory = await mkdtemp(join(tmpdir(), 'dtsx-import-equals-'))
      try {
        await mkdir(join(directory, 'src'))
        const source = `${scenario.statement}\nimport Unused = require('./unused.cjs')\nexport interface Box { value: ${scenario.binding}.Value }\n`
        await writeFile(join(directory, 'src/index.ts'), source)
        await writeFile(join(directory, 'src/options.cts'), 'export interface Value { scale: number }\n')
        await writeFile(join(directory, 'src/unused.cts'), 'export interface UnusedValue { unused: true }\n')
        await writeFile(join(directory, 'consumer.ts'), "import type { Box } from './src/index'\nconst box: Box = { value: { scale: 7 } }\nexport { box }\n")
        await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['consumer.ts'] }))
        const authored = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(authored.ok, authored.output).toBe(true)
        const output = producer.emit(source)
        expect(output).toContain(scenario.statement)
        expect(output).not.toContain('unused.cjs')
        await writeFile(join(directory, 'src/generated.d.ts'), output)
        await writeFile(join(directory, 'consumer.ts'), "import type { Box } from './src/generated'\nconst box: Box = { value: { scale: 7 } }\nexport { box }\n")
        const generated = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(generated.ok, generated.output).toBe(true)
        await writeFile(join(directory, 'consumer.ts'), "import type { Box } from './src/generated'\nconst box: Box = { value: { scale: false } }\nexport { box }\n")
        const negative = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(negative.ok).toBe(false)
        expect(negative.output.match(/error TS\d+/g)).toEqual(['error TS2322'])
      }
      finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
}
