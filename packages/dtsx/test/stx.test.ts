import { afterEach, describe, expect, it } from 'bun:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generator'
import { processSource } from '../src/process-source'
import { isStxFile, parseStxScripts, transformStxToTs } from '../src/stx'
import { runTsc } from './helpers/tsc'

const fixturesDir = join(import.meta.dir, 'fixtures', 'stx')
const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'dtsx-stx-'))
  tempDirs.push(tempDir)
  return tempDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const stxShim = `declare module '@stacksjs/stx' {
  export type DefineComponent<Props = {}, RawBindings = {}, Data = unknown> = {
    new (...args: unknown[]): { $props: Props }
    props?: Props
    setup?: (props: Props) => RawBindings | void
    data?: Data
  }
}
`

async function expectParsesUnderTsc(dts: string, dependencies: Record<string, string> = {}): Promise<void> {
  const tempDir = await createTempDir()
  await writeFile(join(tempDir, 'out.d.ts'), dts)
  await writeFile(join(tempDir, 'stx.d.ts'), stxShim)
  await Promise.all(Object.entries(dependencies).map(([name, content]) => writeFile(join(tempDir, name), content)))
  const { ok, output } = runTsc(tempDir, ['out.d.ts', 'stx.d.ts', ...Object.keys(dependencies)])
  expect(ok ? '' : output).toBe('')
}

async function generateFixtures(entrypoints: string[], isolatedDeclarations: boolean): Promise<string> {
  const tempDir = await createTempDir()
  const srcDir = join(tempDir, 'src')
  const outDir = join(tempDir, 'dist')
  await cp(fixturesDir, srcDir, { recursive: true })
  await generate({
    cwd: tempDir,
    root: './src',
    outdir: './dist',
    entrypoints,
    isolatedDeclarations,
    clean: true,
  })
  return outDir
}

describe('stx component parsing', () => {
  it('detects only terminal .stx extensions', () => {
    expect(isStxFile('/src/Panel.stx')).toBe(true)
    expect(isStxFile('/src/Panel.ts')).toBe(false)
    expect(isStxFile('/src/Panel.stx.ts')).toBe(false)
    expect(isStxFile('/src/Panel.STX')).toBe(false)
  })

  it('collects server, client, universal and Blade TypeScript blocks in document order', () => {
    const source = [
      '@ts',
      'export type First = string',
      '@endts',
      '<script server lang="ts">export const second = 2</script>',
      '<script client type="text/typescript">export const third = 3</script>',
      '<script>export const fourth = 4</script>',
    ].join('\n')
    const blocks = parseStxScripts(source)
    expect(blocks.map(block => block.kind)).toEqual(['ts', 'script', 'script', 'script'])
    expect(blocks.map(block => block.context)).toEqual(['universal', 'server', 'client', 'universal'])
    expect(blocks.map(block => block.lang)).toEqual(['ts', 'ts', 'ts', 'js'])
    expect(blocks.map(block => block.content.trim())).toEqual([
      'export type First = string',
      'export const second = 2',
      'export const third = 3',
      'export const fourth = 4',
    ])
  })

  it('does not close a Blade block for @endts text inside its code', () => {
    const source = `@ts\nconst marker = '@endts'\nexport interface Props { value: string }\nconst props = {} as Props\n@endts\n<div />`
    const blocks = parseStxScripts(source)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toContain(`const marker = '@endts'`)
    expect(blocks[0].content).toContain('interface Props')
  })

  it('keeps an unfinished Blade block usable while a file is being edited', () => {
    const blocks = parseStxScripts('@ts\nexport interface Props { value: string }')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toContain('interface Props')
  })

  it('ignores directive-looking text in plain runtime script strings', () => {
    const source = `<script>\nconst docs = \`export default { props: ['fake'] }\`\n</script>`
    const dts = processSource(source, 'RuntimeDocs.stx')
    expect(dts).toContain('DefineComponent<{}>')
    expect(dts).not.toContain('fake?: unknown')
  })
})

describe('stx component declaration transform', () => {
  it('declares modern STX props, emits, slots, exposed values and named exports', async () => {
    const source = await readFile(join(fixturesDir, 'TypedPanel.stx'), 'utf8')
    const dts = processSource(source, 'TypedPanel.stx')
    expect(dts).toContain(`import type { DefineComponent } from '@stacksjs/stx';`)
    expect(dts).toContain(`import type { PanelTone } from './types';`)
    expect(dts).toContain('title: string')
    expect(dts).toContain('tone?: PanelTone')
    expect(dts).toContain('count?: number')
    expect(dts).toContain('readonly __stxEmits?')
    expect(dts).toContain(`(event: 'select', id: number): void`)
    expect(dts).toContain('readonly __stxSlots?: PanelSlots')
    expect(dts).toContain('readonly __stxExposed?')
    expect(dts).toContain('PANEL_VERSION')
    expect(dts).not.toContain('defineProps')
    expect(dts).not.toContain('withDefaults')
    expect(dts).not.toContain('declare const props')
    expect(dts).toContain('declare const close: () => unknown')
  })

  it('declares Blade-style props assertions without leaking render helpers', async () => {
    const source = await readFile(join(fixturesDir, 'BladeAlert.stx'), 'utf8')
    const dts = processSource(source, 'BladeAlert.stx')
    expect(dts).toContain(`export declare interface AlertProps`)
    expect(dts).toContain(`DefineComponent<AlertProps>`)
    expect(dts).not.toContain('getAlertClass')
    expect(dts).not.toContain('declare const type')
    await expectParsesUnderTsc(dts)
  })

  it('maps STX options-style runtime props', async () => {
    const source = await readFile(join(fixturesDir, 'OptionsBadge.stx'), 'utf8')
    const dts = processSource(source, 'OptionsBadge.stx')
    expect(dts).toContain('label: string')
    expect(dts).toContain('count?: number')
    expect(dts).toContain('active?: boolean')
    expect(dts).toContain('meta?: BadgeMeta')
    expect(dts).not.toContain('PropType')
  })

  it('merges Blade, client and server declarations in source order', async () => {
    const source = await readFile(join(fixturesDir, 'MixedBlocks.stx'), 'utf8')
    const dts = processSource(source, 'MixedBlocks.stx')
    expect(dts).toContain(`export type ServerStatus = 'ready' | 'busy';`)
    expect(dts).toContain(`STATUS_ATTRIBUTE`)
    expect(dts).toContain('status: ServerStatus')
    expect(dts).toContain('retries?: number')
    expect(dts).not.toContain('declare const retries')
  })

  it('emits an empty STX component for template-only files', async () => {
    const source = await readFile(join(fixturesDir, 'TemplateOnly.stx'), 'utf8')
    const dts = processSource(source, 'TemplateOnly.stx')
    expect(dts).toContain('DefineComponent<{}>')
    expect(dts).toContain('export default __dtsx_component__;')
    await expectParsesUnderTsc(dts)
  })

  it('supports inline object props and typed $props annotations', () => {
    const inline = processSource(`@ts\nconst local = props as { id: string; nested?: { count: number } }\n@endts`, 'Inline.stx')
    expect(inline).toContain('id: string')
    expect(inline).toContain('nested?: { count: number }')

    const annotation = processSource(`@ts\nimport type { ExternalProps } from './external'\ndeclare const $props: ExternalProps\n@endts`, 'Annotated.stx')
    expect(annotation).toContain('DefineComponent<ExternalProps>')
    expect(annotation).toContain(`from './external'`)
  })

  it('infers legacy Blade-style $props access with useful default-value types', async () => {
    const source = `<script server>
export const title = $props.title || 'Untitled'
export const count = $props.count ?? 0
export const enabled = $props.enabled !== false
export const items = $props.items || []
export const metadata = $props['metadata'] || {}
export const opaque = $props.value
</script>`
    const dts = processSource(source, 'LegacyProps.stx')
    expect(dts).toContain('title?: string')
    expect(dts).toContain('count?: number')
    expect(dts).toContain('enabled?: boolean')
    expect(dts).toContain('items?: unknown[]')
    expect(dts).toContain('metadata?: Record<string, unknown>')
    expect(dts).toContain('value?: unknown')
    await expectParsesUnderTsc(dts)
  })

  it('ignores $props examples in comments and strings while preserving Unicode offsets', () => {
    const source = `<script server>
const emoji = '🔥 $props.fake'
// $props.commented
export const label = $props.label || 'Label'
</script>`
    const dts = processSource(source, 'UnicodeProps.stx')
    expect(dts).toContain('label?: string')
    expect(dts).not.toContain('fake?:')
    expect(dts).not.toContain('commented?:')
  })

  it('always declares components whose client scripts begin with runtime expressions', () => {
    const iife = processSource(`<script client>\n(() => { const ready = true })()\n</script>`, 'Iife.stx')
    const browserCall = processSource(`<script client>\nwindow.addEventListener('ready', () => {})\n</script>`, 'BrowserCall.stx')
    expect(iife).toContain('export default __dtsx_component__;')
    expect(browserCall).toContain('export default __dtsx_component__;')
  })

  it('handles comments and nested generic types without corrupting declarations', async () => {
    const source = `<script server lang="ts">
defineProps<{
  /** Values grouped by key. */
  groups: ReadonlyMap<string, Array<{ id: string; run: () => Promise<void> }>>
  label?: string // accessible label
}>()
</script>`
    const dts = processSource(source, 'Nested.stx')
    expect(dts).toContain('ReadonlyMap<string, Array<{ id: string; run: () => Promise<void> }>>')
    expect(dts).toContain('/* accessible label */')
    expect(dts).not.toMatch(/\*\/;/)
    await expectParsesUnderTsc(dts)
  })

  it('produces equivalent public contracts in semantic and isolated modes', async () => {
    const source = await readFile(join(fixturesDir, 'TypedPanel.stx'), 'utf8')
    const semantic = processSource(source, 'TypedPanel.stx', true, ['bun'], false)
    const isolated = processSource(source, 'TypedPanel.stx', true, ['bun'], true)
    for (const expected of ['title: string', 'tone?: PanelTone', '__stxEmits', '__stxSlots', 'PANEL_VERSION']) {
      expect(semantic).toContain(expected)
      expect(isolated).toContain(expected)
    }
    expect(isolated).toContain('export default __dtsx_component__;')
  })

  it('returns a plain default-export script unchanged', () => {
    const virtual = transformStxToTs(`<script>\nconst component = class Card {}\nexport default component\n</script>`)
    expect(virtual).toContain('export default component')
    expect(virtual).not.toContain('__dtsx_component__')
  })
})

describe('stx project generation', () => {
  for (const isolatedDeclarations of [false, true]) {
    it(`emits and typechecks STX entrypoints in ${isolatedDeclarations ? 'isolated' : 'semantic'} mode`, async () => {
      const outDir = await generateFixtures(['**/*.{stx,ts}'], isolatedDeclarations)
      const panel = await readFile(join(outDir, 'TypedPanel.d.ts'), 'utf8')
      const blade = await readFile(join(outDir, 'BladeAlert.d.ts'), 'utf8')
      const options = await readFile(join(outDir, 'OptionsBadge.d.ts'), 'utf8')
      const mixed = await readFile(join(outDir, 'MixedBlocks.d.ts'), 'utf8')
      const template = await readFile(join(outDir, 'TemplateOnly.d.ts'), 'utf8')
      const types = await readFile(join(outDir, 'types.d.ts'), 'utf8')

      expect(panel).toContain('title: string')
      expect(blade).toContain('DefineComponent<AlertProps>')
      expect(options).toContain('meta?: BadgeMeta')
      expect(mixed).toContain('status: ServerStatus')
      expect(template).toContain('DefineComponent<{}>')
      expect(types).toContain('PanelTone')

      await expectParsesUnderTsc(panel, {
        'types.d.ts': types,
      })
    })
  }

  it('discovers .stx files through default entrypoints', async () => {
    const tempDir = await createTempDir()
    await cp(fixturesDir, join(tempDir, 'src'), { recursive: true })
    await generate({ cwd: tempDir, root: './src', outdir: './dist', clean: true })
    expect(await readFile(join(tempDir, 'dist', 'TypedPanel.d.ts'), 'utf8')).toContain('title: string')
  })

  it('auto-includes and rewrites explicitly imported .stx components', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')
    await cp(fixturesDir, srcDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `import TypedPanel from './TypedPanel.stx'\nexport { TypedPanel }\n`)
    await generate({ cwd: tempDir, root: './src', outdir: './dist', entrypoints: ['index.ts'], clean: true })

    const index = await readFile(join(outDir, 'index.d.ts'), 'utf8')
    expect(index).toContain(`from './TypedPanel'`)
    expect(index).not.toContain('.stx')
    expect(await readFile(join(outDir, 'TypedPanel.d.ts'), 'utf8')).toContain('title: string')
  })

  it('resolves extensionless imports to STX components', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')
    await cp(fixturesDir, srcDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `export { default as TemplateOnly } from './TemplateOnly'\n`)
    await generate({ cwd: tempDir, root: './src', outdir: './dist', entrypoints: ['index.ts'], clean: true })

    expect(await readFile(join(outDir, 'index.d.ts'), 'utf8')).toContain(`from './TemplateOnly'`)
    expect(await readFile(join(outDir, 'TemplateOnly.d.ts'), 'utf8')).toContain('DefineComponent<{}>')
  })
})
