import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeImports } from '../src/processor/imports'
import { isAvailable, runTsc } from './helpers/tsc'

test('merging imports preserves distinct decoded module identities with escaped matching quotes', async () => {
  expect(isAvailable).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-import-merge-'))
  try {
    const imports = ["import type { Left } from './option\\'a';", "import type { Right } from './option\\'b';"]
    const signature = '\nexport interface Pair { left: Left; right: Right }\n'
    await writeFile(join(directory, "option'a.ts"), 'export interface Left { value: number }\n')
    await writeFile(join(directory, "option'b.ts"), 'export interface Right { value: string }\n')
    await writeFile(join(directory, 'authored.ts'), imports.join('\n') + signature)
    const consumer = (module: string, value: string): string => `import type { Pair } from '${module}'\nconst pair: Pair = { left: { value: 7 }, right: { value: ${value} } }\nexport { pair }\n`
    await writeFile(join(directory, 'consumer.ts'), consumer('./authored', "'valid'"))
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['consumer.ts'] }))
    const authored = runTsc(directory, ['--project', 'tsconfig.json'])
    expect(authored.ok, authored.output).toBe(true)
    const output = mergeImports(imports).join('\n') + signature
    await writeFile(join(directory, 'generated.d.ts'), output)
    await writeFile(join(directory, 'consumer.ts'), consumer('./generated', "'valid'"))
    const generated = runTsc(directory, ['--project', 'tsconfig.json'])
    expect(generated.ok, `${output}\n${generated.output}`).toBe(true)
    await writeFile(join(directory, 'consumer.ts'), consumer('./generated', 'false'))
    const negative = runTsc(directory, ['--project', 'tsconfig.json'])
    expect(negative.ok).toBe(false)
    expect(negative.output.match(/error TS\d+/g)).toEqual(['error TS2322'])
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

test('merging equivalent module spellings uses their decoded identity', () => {
  const output = mergeImports(["import type { Left } from './options';", "import type { Right } from '\\u002e/options';"])
  expect(output).toEqual(["import type { Left, Right } from './options';"])
})
