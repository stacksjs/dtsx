import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'bun:test'
import { dts } from '../../../bun-plugin/src'
import { processSource } from '../../../zig-dtsx/src'
import { generate } from '../../src'
import { isAvailable, runTsc } from './tsc'

interface RetainedFixture {
  declaration: string
  signature: string
  exportStatement?: string
  defaultImport?: string
  numberExpression?: string
  radiusExpression?: string
  prunedDeclaration?: string
  overloads?: boolean
  privateOverloads?: boolean
}

export const retainedVariants = {
  direct: { declaration: "import type { ProjectionLike } from './base'\ninterface LocalProjection extends ProjectionLike { radius: number }", signature: 'extends ProjectionLike' },
  renamed: { declaration: "import type { ProjectionLike as BaseProjection } from './base'\ninterface LocalProjection extends BaseProjection { radius: number }", signature: 'extends BaseProjection' },
  namespace: { declaration: "import type * as Geo from './base'\ninterface LocalProjection extends Geo.ProjectionLike { radius: number }", signature: 'extends Geo.ProjectionLike' },
  transitive: { declaration: "import type { ProjectionLike } from './base'\ninterface ParentProjection extends ProjectionLike {}\ninterface LocalProjection extends ParentProjection { radius: number }", signature: 'extends ProjectionLike' },
  member: { declaration: "import type { ProjectionLike } from './base'\ninterface LocalProjection { radius: number; projection: ProjectionLike }", signature: 'projection: ProjectionLike' },
  unreferenced: { declaration: "import type { ProjectionLike, Metadata, Unused } from './base'\ninterface Dormant extends Metadata {}\ninterface LocalProjection extends ProjectionLike { radius: number }", signature: 'extends ProjectionLike' },
  defaultInterface: { declaration: "import type { ProjectionLike } from './base'\ninterface LocalProjection extends ProjectionLike { radius: number }", exportStatement: 'const Mercator: LocalProjection = { radius: 42, project(latitude: number): number { return latitude } }\nexport default Mercator', defaultImport: 'Mercator', signature: 'extends ProjectionLike' },
  defaultVariable: { declaration: "import type { ProjectionLike } from './base'", exportStatement: 'const configuration: ProjectionLike = { project(latitude: number): number { return latitude } }\nexport default configuration', defaultImport: 'configuration', numberExpression: 'configuration.project(10)', radiusExpression: 'configuration.project(10)', signature: 'ProjectionLike' },
  defaultFunction: { declaration: "import type { ProjectionLike } from './base'\nfunction factory(value: ProjectionLike): ProjectionLike { return value }", exportStatement: 'export default factory', defaultImport: 'factory', numberExpression: 'factory({ project(latitude: number): number { return latitude } }).project(10)', radiusExpression: 'factory({ project(latitude: number): number { return latitude } }).project(10)', signature: 'ProjectionLike' },
  asyncDefaultFunction: { declaration: "import type { ProjectionLike } from './base'\nasync function factory(value: ProjectionLike): Promise<ProjectionLike> { return value }", exportStatement: 'export default factory', defaultImport: 'factory', numberExpression: '(await factory({ project(latitude: number): number { return latitude } })).project(10)', radiusExpression: '(await factory({ project(latitude: number): number { return latitude } })).project(10)', signature: 'ProjectionLike' },
  unreachableFunction: { declaration: "import type { ProjectionLike, Unused } from './base'\nfunction hiddenUnused(value: Unused): Unused { return value }\ninterface LocalProjection extends ProjectionLike { radius: number }", prunedDeclaration: 'hiddenUnused', signature: 'extends ProjectionLike' },
  unreachableAsyncFunction: { declaration: "import type { ProjectionLike, Unused } from './base'\nasync function hiddenUnused(value: Unused): Promise<Unused> { return value }\ninterface LocalProjection extends ProjectionLike { radius: number }", prunedDeclaration: 'hiddenUnused', signature: 'extends ProjectionLike' },
  retainedFunctionWithOverloads: { declaration: "import type { ProjectionLike } from './base'\nfunction factory(value: ProjectionLike): ProjectionLike { return value }\nexport function parse(value: string): number;\nexport function parse(value: number): string;\nexport function parse(value: string | number): string | number { return typeof value === 'string' ? value.length : String(value) }", exportStatement: 'export default factory', defaultImport: 'factory', numberExpression: 'factory({ project(latitude: number): number { return latitude } }).project(10)', radiusExpression: 'factory({ project(latitude: number): number { return latitude } }).project(10)', overloads: true, signature: 'ProjectionLike' },
  privateImplementationOnly: { declaration: "import type { Unused } from './base'\nfunction hiddenUnused(value: Unused): Unused { return value }\nfunction factory(value: number): number;\nfunction factory(value: string): string;\nfunction factory(value: number | string | typeof hiddenUnused): number | string | typeof hiddenUnused { return value }", exportStatement: 'export default factory', defaultImport: 'factory', numberExpression: 'factory(42)', radiusExpression: 'factory(42)', privateOverloads: true, prunedDeclaration: 'hiddenUnused', signature: 'function factory' },
  exportedImplementationOnly: { declaration: "import type { Unused } from './base'\nfunction hiddenUnused(value: Unused): Unused { return value }\nfunction factory(value: number): number { return value }\nexport function parse(value: string): number;\nexport function parse(value: number): string;\nexport function parse(value: string | number | typeof hiddenUnused): string | number | typeof hiddenUnused { return value }", exportStatement: 'export default factory', defaultImport: 'factory', numberExpression: 'factory(42)', radiusExpression: 'factory(42)', overloads: true, prunedDeclaration: 'hiddenUnused', signature: 'function parse' },
  retainedFunctionReturn: { declaration: "import type { ProjectionLike } from './base'\nfunction hiddenRequired(value: ProjectionLike): ProjectionLike { return value }\nfunction factory(): typeof hiddenRequired { return hiddenRequired }", exportStatement: 'export default factory', defaultImport: 'factory', numberExpression: 'factory()({ project(latitude: number): number { return latitude } }).project(10)', radiusExpression: 'factory()({ project(latitude: number): number { return latitude } }).project(10)', signature: 'typeof hiddenRequired' },
  privateOverloadedFunction: { declaration: "import type { ProjectionLike } from './base'\nfunction factory(value: ProjectionLike): ProjectionLike;\nfunction factory(value: number): number;\nfunction factory(value: ProjectionLike | number): ProjectionLike | number { return value }", exportStatement: 'export default factory', defaultImport: 'factory', numberExpression: 'factory({ project(latitude: number): number { return latitude } }).project(10)', radiusExpression: 'factory({ project(latitude: number): number { return latitude } }).project(10)', privateOverloads: true, signature: 'ProjectionLike' },
}

export async function packedRetainedGraph(producer: 'core' | 'bun-plugin' | 'native', variant: keyof typeof retainedVariants = 'direct'): Promise<void> {
  const fixture: RetainedFixture = retainedVariants[variant]
  const numberExpression = fixture.numberExpression ?? `${variant === 'member' ? 'Mercator.projection' : 'Mercator'}.project(10)`
  const positiveImport = fixture.defaultImport ? `${fixture.defaultImport}, { Archive }` : '{ Mercator, Archive }'
  const valueImport = fixture.defaultImport ?? '{ Mercator }'
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-interface-import-'))
  const library = join(directory, 'library')
  const consumer = join(directory, 'consumer')
  try {
    await mkdir(join(library, 'src'), { recursive: true })
    await mkdir(consumer)
    await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'interface-library', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
    await writeFile(join(library, 'src/base.ts'), 'export interface ProjectionLike { project(latitude: number): number }\nexport interface Metadata { tag: string }\nexport interface Unused { unused: true }\n')
    await writeFile(join(library, 'src/index.ts'), `
${fixture.declaration}
${fixture.exportStatement ?? `export const Mercator: LocalProjection = ${variant === 'member' ? '{ radius: 42, projection: { project(latitude: number): number { return latitude } } }' : '{ radius: 42, project(latitude: number): number { return latitude } }'}`}
export class Archive {
  private hidden(): void {}
  async *entries(): AsyncGenerator<{ tileId: number }> { yield { tileId: 1 } }
  static *syncEntries(): Generator<{ tileId: number }> { yield { tileId: 1 } }
  *inferredEntries() { yield 1 }
  async *inferredAsyncEntries() { yield 1 }
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
    else if (producer === 'native') {
      await writeFile(join(library, 'dist/base.d.ts'), processSource(await readFile(join(library, 'src/base.ts'), 'utf8'), true))
      await writeFile(join(library, 'dist/index.d.ts'), processSource(await readFile(join(library, 'src/index.ts'), 'utf8'), true))
    }

    const archive = join(directory, 'library.tgz')
    const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library })
    expect(packed.exitCode, packed.stderr.toString()).toBe(0)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'strict-interface-consumer', private: true, type: 'module', dependencies: { 'interface-library': `file:${archive}` } }))
    for (const args of [[process.execPath, 'install'], [process.execPath, 'install', '--frozen-lockfile']]) {
      const installed = Bun.spawnSync(args, { cwd: consumer })
      expect(installed.exitCode, installed.stderr.toString()).toBe(0)
    }
    await writeFile(join(consumer, 'positive.ts'), `import ${positiveImport} from 'interface-library'
const radius: number = ${fixture.radiusExpression ?? 'Mercator.radius'}
const projected: number = ${numberExpression}
const entries: AsyncGenerator<{ tileId: number }> = new Archive().entries()
const syncEntries: Generator<{ tileId: number }> = Archive.syncEntries()
const inferredEntries: Generator<unknown, void, unknown> = new Archive().inferredEntries()
const inferredAsyncEntries: AsyncGenerator<unknown, void, unknown> = new Archive().inferredAsyncEntries()
void [radius, projected, entries, syncEntries, inferredEntries, inferredAsyncEntries]
${fixture.overloads ? "import { parse } from 'interface-library'\nconst fromString: number = parse('value')\nconst fromNumber: string = parse(42)\nvoid [fromString, fromNumber]" : ''}
${fixture.privateOverloads ? 'const fromNumber: number = factory(42)\nvoid fromNumber' : ''}
`)
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['positive.ts'] }))
    const positive = runTsc(consumer, ['--project', 'tsconfig.json'])
    expect(positive.ok, positive.output).toBe(true)
    await writeFile(join(consumer, 'negative.ts'), `import ${valueImport} from 'interface-library'
const invalid: string = ${numberExpression}
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
    if (producer === 'native') {
      await writeFile(join(consumer, 'missing.ts'), `import ${valueImport} from 'interface-library'\n${fixture.defaultImport ?? 'Mercator'}.missing\n`)
      await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['missing.ts'] }))
      const missing = runTsc(consumer, ['--project', 'tsconfig.json'])
      expect(missing.ok).toBe(false)
      expect(missing.output.match(/error TS\d+/g)).toEqual(['error TS2339'])
    }
    for (const [type, expression] of [['AsyncGenerator', 'new Archive().entries()'], ['Generator', 'Archive.syncEntries()']]) {
      await writeFile(join(consumer, 'generator-negative.ts'), `import { Archive } from 'interface-library'\nconst invalid: ${type}<{ tileId: string }> = ${expression}\nvoid invalid\n`)
      await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['generator-negative.ts'] }))
      const generatorMismatch = runTsc(consumer, ['--project', 'tsconfig.json'])
      expect(generatorMismatch.ok).toBe(false)
      expect(generatorMismatch.output.match(/error TS\d+/g)).toEqual(['error TS2322'])
    }
    if (fixture.overloads || fixture.privateOverloads) {
      await writeFile(join(consumer, 'overload.ts'), fixture.privateOverloads ? "import factory from 'interface-library'\nfactory(true)\n" : "import { parse } from 'interface-library'\nparse(true)\n")
      await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['overload.ts'] }))
      const invalidOverload = runTsc(consumer, ['--project', 'tsconfig.json'])
      expect(invalidOverload.ok).toBe(false)
      expect(invalidOverload.output.match(/error TS\d+/g)).toEqual(['error TS2769'])
    }
    const declarations = await readFile(join(consumer, 'node_modules/interface-library/dist/index.d.ts'), 'utf8')
    expect(declarations).toContain(fixture.signature)
    expect(declarations).not.toContain('Unused')
    if (variant === 'unreferenced') {
      expect(declarations).not.toContain('Dormant')
      expect(declarations).not.toContain('Metadata')
    }
    if (fixture.prunedDeclaration) expect(declarations).not.toContain(fixture.prunedDeclaration)
    expect(declarations).toContain('entries(): AsyncGenerator<')
    expect(declarations).toContain('static syncEntries(): Generator<')
    expect(declarations).toContain('inferredEntries(): Generator<unknown, void, unknown>')
    expect(declarations).toContain('inferredAsyncEntries(): AsyncGenerator<unknown, void, unknown>')
    expect(declarations).not.toContain('*entries')
    expect(declarations).not.toContain('*syncEntries')
  }
  finally { await rm(directory, { recursive: true, force: true }) }
}
