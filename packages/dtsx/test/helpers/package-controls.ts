import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from 'bun:test'
import { runTsc } from './tsc'

interface Controls { positive: string, negatives: Array<{ text: string, code: string }> }

/** One strict program: the positive file and declarations must be clean, and
 * every independent negative module must report exactly its expected error. */
export async function assertPackageControls(root: string, specifier: string, fixture: Controls): Promise<void> {
  const files = ['positive.ts', ...fixture.negatives.map((_, index) => `negative-${String(index).padStart(3, '0')}.ts`)]
  const prefix = `import * as api from '${specifier}';\n`
  await writeFile(join(root, files[0]), prefix + fixture.positive)
  for (const [index, negative] of fixture.negatives.entries()) await writeFile(join(root, files[index + 1]), prefix + negative.text)
  await writeFile(join(root, 'tsconfig.controls.json'), JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files }))
  const result = runTsc(root, ['--project', 'tsconfig.controls.json'])
  expect(result.ok, result.output).toBe(false)
  expect(result.output.match(/error TS\d+/g) ?? [], result.output).toEqual(fixture.negatives.map(negative => `error ${negative.code}`))
  const failingModules = [...result.output.matchAll(/negative-(\d+)\.ts\(\d+,\d+\): error TS\d+/g)].map(match => Number(match[1]))
  expect(failingModules, result.output).toEqual(fixture.negatives.map((_, index) => index))
}
