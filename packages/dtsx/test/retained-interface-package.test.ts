import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dts } from '../../bun-plugin/src'
import { generate } from '../src'
import { isAvailable, runTsc } from './helpers/tsc'

const variants = {
  direct: { declaration: "import type { ProjectionLike } from './base'\ninterface LocalProjection extends ProjectionLike { radius: number }", signature: 'extends ProjectionLike' },
  renamed: { declaration: "import type { ProjectionLike as BaseProjection } from './base'\ninterface LocalProjection extends BaseProjection { radius: number }", signature: 'extends BaseProjection' },
  namespace: { declaration: "import type * as Geo from './base'\ninterface LocalProjection extends Geo.ProjectionLike { radius: number }", signature: 'extends Geo.ProjectionLike' },
  transitive: { declaration: "import type { ProjectionLike } from './base'\ninterface ParentProjection extends ProjectionLike {}\ninterface LocalProjection extends ParentProjection { radius: number }", signature: 'extends ProjectionLike' },
  member: { declaration: "import type { ProjectionLike } from './base'\ninterface LocalProjection { radius: number; projection: ProjectionLike }", signature: 'projection: ProjectionLike' },
  unreferenced: { declaration: "import type { ProjectionLike, Metadata, Unused } from './base'\ninterface Dormant extends Metadata {}\ninterface LocalProjection extends ProjectionLike { radius: number }", signature: 'extends ProjectionLike' },
}

async function packedInterface(producer: 'core' | 'bun-plugin', variant: keyof typeof variants = 'direct'): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-interface-import-'))
  const library = join(directory, 'library')
  const consumer = join(directory, 'consumer')
  try {
    await mkdir(join(library, 'src'), { recursive: true })
    await mkdir(consumer)
    await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'interface-library', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
    await writeFile(join(library, 'src/base.ts'), 'export interface ProjectionLike { project(latitude: number): number }\nexport interface Metadata { tag: string }\nexport interface Unused { unused: true }\n')
    await writeFile(join(library, 'src/index.ts'), `
${variants[variant].declaration}
export const Mercator: LocalProjection = ${variant === 'member' ? '{ radius: 42, projection: { project(latitude: number): number { return latitude } } }' : '{ radius: 42, project(latitude: number): number { return latitude } }'}
export class Archive {
  private hidden(): void {}
  async *entries(): AsyncGenerator<{ tileId: number }> { yield { tileId: 1 } }
}
`)
    const compilerOptions = { module: 'Preserve', moduleResolution: 'Bundler', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions, include: ['src/index.ts'] }))
    expect(isAvailable).toBe(true)
    const source = runTsc(library, ['--project', 'tsconfig.json'])
    expect(source.ok, source.output).toBe(true)
    const entrypoints = [join(library, 'src/index.ts')]
    const built = await Bun.build({ entrypoints, outdir: join(library, 'dist'), target: 'bun', plugins: producer === 'bun-plugin' ? [dts({ cwd: library, root: './src', entrypoints: ['index.ts'], outdir: './dist' })] : [] })
    expect(built.success).toBe(true)
    if (producer === 'core') await generate({ cwd: library, root: './src', entrypoints: ['index.ts'], outdir: './dist' })

    const archive = join(directory, 'library.tgz')
    const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library })
    expect(packed.exitCode, packed.stderr.toString()).toBe(0)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'strict-interface-consumer', private: true, type: 'module', dependencies: { 'interface-library': `file:${archive}` } }))
    for (const args of [[process.execPath, 'install'], [process.execPath, 'install', '--frozen-lockfile']]) {
      const installed = Bun.spawnSync(args, { cwd: consumer })
      expect(installed.exitCode, installed.stderr.toString()).toBe(0)
    }
    await writeFile(join(consumer, 'positive.ts'), `import { Mercator, Archive } from 'interface-library'
const radius: number = Mercator.radius
const projected: number = ${variant === 'member' ? 'Mercator.projection' : 'Mercator'}.project(10)
const entries: AsyncGenerator<{ tileId: number }> = new Archive().entries()
void [radius, projected, entries]
`)
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['positive.ts'] }))
    const positive = runTsc(consumer, ['--project', 'tsconfig.json'])
    expect(positive.ok, positive.output).toBe(true)
    await writeFile(join(consumer, 'negative.ts'), `import { Mercator } from 'interface-library'
const invalid: string = ${variant === 'member' ? 'Mercator.projection' : 'Mercator'}.project(10)
void invalid
`)
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['negative.ts'] }))
    const negative = runTsc(consumer, ['--project', 'tsconfig.json'])
    expect(negative.ok).toBe(false)
    expect(negative.output.match(/error TS\d+/g)).toEqual(['error TS2322'])
    expect(negative.output).toContain('negative.ts(2,')
    await writeFile(join(consumer, 'private.ts'), `import { Archive } from 'interface-library'
new Archive().hidden()
`)
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['private.ts'] }))
    const privacy = runTsc(consumer, ['--project', 'tsconfig.json'])
    expect(privacy.ok).toBe(false)
    expect(privacy.output.match(/error TS\d+/g)).toEqual(['error TS2339'])
    expect(privacy.output).toContain('private.ts(2,')
    const declarations = await readFile(join(consumer, 'node_modules/interface-library/dist/index.d.ts'), 'utf8')
    expect(declarations).toContain(variants[variant].signature)
    expect(declarations).not.toContain('Unused')
    if (variant === 'unreferenced') {
      expect(declarations).not.toContain('Dormant')
      expect(declarations).not.toContain('Metadata')
    }
    expect(declarations).toContain('entries(): AsyncGenerator<')
    expect(declarations).not.toContain('*entries')
  }
  finally { await rm(directory, { recursive: true, force: true }) }
}

for (const producer of ['core', 'bun-plugin'] as const) {
  test(`${producer} retains an imported base of a local interface used by an exported value in a normal strict packed consumer`, async () => {
    await packedInterface(producer)
  })
}

for (const variant of ['renamed', 'namespace', 'transitive', 'member', 'unreferenced'] as const) {
  for (const producer of ['core', 'bun-plugin'] as const) {
    const behavior = variant === 'unreferenced' ? 'prunes unreachable interface imports alongside required imports' : `retains ${variant} local interface imports without retaining unused bindings`
    test(`${producer} ${behavior}`, async () => {
      await packedInterface(producer, variant)
    })
  }
}
