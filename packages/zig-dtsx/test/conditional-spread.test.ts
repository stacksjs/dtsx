import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isAvailable, runTsc } from '../../dtsx/test/helpers/tsc'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const source = `export interface Options {
  resource: string
  servers: readonly string[]
  scopes?: readonly string[]
  documentation?: string
}
export function metadata(options: Options) {
  return {
    resource: options.resource,
    servers: [...options.servers],
    /* optional scopes */ ...(options.scopes ? { scopes: [...options.scopes] } : {}),
    ...(options.documentation ? {} : { missing: true }),
    ...(options.documentation ? { documentation: options.documentation } : {}),
  }
}`

const positive = `import { metadata } from './index.js'
const result = metadata({ resource: 'https://example.com', servers: ['https://auth.example.com'] })
const resource: string = result.resource
const servers: string[] = result.servers
const scopes: string[] | undefined = result.scopes
const documentation: string | undefined = result.documentation
const missing: boolean | undefined = result.missing
result.servers.push('https://other.example.com')
result.scopes?.push('read')
void [resource, servers, scopes, documentation, missing]
`

test('conditional object spreads retain strict public types through actual native emission', async () => {
  expect(ZIG_AVAILABLE).toBe(true)
  expect(isAvailable).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-conditional-spread-'))
  try {
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true },
      files: ['consumer.ts'],
    }))
    for (const [name, content] of [['source', source], ['native', processSource(source)]]) {
      await rm(join(directory, 'index.ts'), { force: true })
      await rm(join(directory, 'index.d.ts'), { force: true })
      await writeFile(join(directory, name === 'source' ? 'index.ts' : 'index.d.ts'), content!)
      await writeFile(join(directory, 'consumer.ts'), positive)
      const valid = runTsc(directory, ['--project', 'tsconfig.json'])
      expect(valid.ok, `${name}: ${valid.output}`).toBe(true)
      for (const invalid of ['const invalid: number = result.resource', 'const invalid: number[] | undefined = result.scopes', 'const invalid: string = result.documentation']) {
        await writeFile(join(directory, 'consumer.ts'), `${positive}\n${invalid}\nvoid invalid`)
        const rejected = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(rejected.ok, `${name}: ${invalid}`).toBe(false)
        expect(rejected.output.match(/error TS\d+/g), rejected.output).toEqual(['error TS2322'])
      }
    }
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
