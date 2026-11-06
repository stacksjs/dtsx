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
    { name: 'an apostrophe', literal: `"./option's"`, target: "option's.ts" },
    { name: 'an escaped apostrophe', literal: '"./option\\x27s"', target: "option's.ts" },
    { name: 'an escaped matching quote', literal: "'./option\\'s'", target: "option's.ts" },
    { name: 'an escaped path prefix', literal: "'\\u002e/options'", target: 'options.ts' },
    { name: 'a namespace import with an apostrophe', literal: `"./option's"`, target: "option's.ts", binding: 'type * as Module', value: 'Module.Options' },
    { name: 'a default import with an apostrophe', literal: `"./option's"`, target: "option's.ts", binding: 'type Default', value: 'Default' },
    { name: 'mixed bindings with an apostrophe', literal: `"./option's"`, target: "option's.ts", binding: 'Default, { type Options }', value: 'Default & Options' },
  ]) {
    test(`${producer.name} preserves ${scenario.name} in an imported module name`, async () => {
      expect(isAvailable).toBe(true)
      if (producer.name === 'native') expect(native.ZIG_AVAILABLE).toBe(true)
      const directory = await mkdtemp(join(tmpdir(), 'dtsx-quoted-module-'))
      try {
        await mkdir(join(directory, 'src'))
        const source = `import ${scenario.binding ?? 'type { Options }'} from ${scenario.literal}\nexport interface Box { value: ${scenario.value ?? 'Options'} }\n`
        await writeFile(join(directory, 'src/index.ts'), source)
        await writeFile(join(directory, 'src', scenario.target), 'export interface Options { scale: number }\nexport default interface DefaultOptions { scale: number }\n')
        const consumer = (module: string, value: string): string => `import type { Box } from '${module}'\nconst box: Box = { value: { scale: ${value} } }\nexport { box }\n`
        await writeFile(join(directory, 'consumer.ts'), consumer('./src/index', '7'))
        await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['consumer.ts'] }))
        const authored = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(authored.ok, authored.output).toBe(true)
        const output = producer.emit(source)
        await writeFile(join(directory, 'src/generated.d.ts'), output)
        await writeFile(join(directory, 'consumer.ts'), consumer('./src/generated', '7'))
        const generated = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(generated.ok, `${output}\n${generated.output}`).toBe(true)
        await writeFile(join(directory, 'consumer.ts'), consumer('./src/generated', 'false'))
        const negative = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(negative.ok).toBe(false)
        expect(negative.output.match(/error TS\d+/g)).toEqual(['error TS2322'])
      }
      finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
}
