import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..', '..', '..')
const packagesDir = join(repoRoot, 'packages')

const publishable = readdirSync(packagesDir)
  .filter(directory => existsSync(join(packagesDir, directory, 'package.json')))
  .map((directory) => {
    const manifest: { name: string, private?: boolean } = JSON.parse(readFileSync(join(packagesDir, directory, 'package.json'), 'utf8'))
    return { directory, manifest }
  })
  .filter(({ manifest }) => !manifest.private)
const names = new Set(publishable.map(item => item.manifest.name))

const documents = [
  join(repoRoot, 'README.md'),
  ...readdirSync(join(repoRoot, 'docs')).filter(file => file.endsWith('.md')).map(file => join(repoRoot, 'docs', file)),
  ...publishable.map(item => join(packagesDir, item.directory, 'README.md')),
].filter(path => existsSync(path))

/** Lines a ```diff block removes: what a migration tells readers to replace. */
function withoutRemovedLines(text: string): string {
  return text.replace(/```diff\n[\s\S]*?```/g, block => block.split('\n').filter(line => !/^\s*-/.test(line)).join('\n'))
}

/** Package names a document tells readers to install or import. */
function namedPackages(markdown: string): string[] {
  const text = withoutRemovedLines(markdown)
  // A package name: `name` or `@scope/name`, where dtsx is the scope or in the name.
  const installed = [...text.matchAll(/(?:bun add|npm install|npm i|pnpm add|yarn add)(?:\s+-[-\w]+)*\s+((?:@[\w.-]+\/)?[\w.-]+)/g)].map(match => match[1])
  const imported = [...text.matchAll(/(?:from |require\()'((?:@[\w.-]+\/)?[\w.-]+)(?:\/[\w./-]+)?'/g)].map(match => match[1])
  return [...installed, ...imported].filter(name => name.startsWith('@dtsx/') || /(?:^|[-/])dtsx(?:$|-)/.test(name))
}

const tracked = Bun.spawnSync(['git', 'ls-files'], { cwd: repoRoot }).stdout.toString().trim().split('\n')

describe('published package names', () => {
  // `@stacksjs/dtsx` was renamed to `@dtsx/dtsx` after v0.11.36.
  test('the SDK publishes as @dtsx/dtsx', () => {
    expect(publishable.find(item => item.directory === 'dtsx')?.manifest.name).toBe('@dtsx/dtsx')
  })

  test('every plugin depends on @dtsx/dtsx', () => {
    for (const { directory, manifest } of publishable.filter(item => item.directory.endsWith('-plugin'))) {
      const dependencies = (manifest as { dependencies?: Record<string, string> }).dependencies ?? {}
      expect({ directory, sdk: dependencies['@dtsx/dtsx'] }).toEqual({ directory, sdk: 'workspace:*' })
    }
  })

  test('the former name appears only in migration notes', () => {
    const migrationNotes = new Set(['README.md', 'packages/dtsx/README.md', 'docs/install.md', 'docs/MIGRATION.md', 'CHANGELOG.md', 'packages/dtsx/test/workspace-package-names.test.ts'])
    const formerName = ['@stacksjs', 'dtsx'].join('/')
    const mentions = tracked.filter(file => !migrationNotes.has(file) && existsSync(join(repoRoot, file)) && readFileSync(join(repoRoot, file), 'utf8').includes(formerName))
    expect(mentions).toEqual([])
  })

  // Every bundler plugin publishes in the dtsx npm org, named after its tool
  // (npm also rejects `vite-plugin-dtsx` as too similar to `vite-plugin-dts`).
  test('every plugin publishes as @dtsx/<tool>', () => {
    const plugins = Object.fromEntries(publishable.filter(item => item.directory.endsWith('-plugin')).map(item => [item.directory, item.manifest.name]))
    expect(plugins).toEqual({
      'bun-plugin': '@dtsx/bun',
      'esbuild-plugin': '@dtsx/esbuild',
      'tsdown-plugin': '@dtsx/tsdown',
      'tsup-plugin': '@dtsx/tsup',
      'vite-plugin': '@dtsx/vite',
      'webpack-plugin': '@dtsx/webpack',
    })
  })

  test.each(documents.map(path => [path.slice(repoRoot.length + 1), path]))('%s names only real workspace packages', (_label, path) => {
    for (const name of namedPackages(readFileSync(path, 'utf8')))
      expect(names.has(name) ? name : `unknown package ${name}`).toBe(name)
  })

  test('the matcher finds install and import names', () => {
    const text = [
      'bun add @dtsx/vite -d',
      'npm install --save-dev @dtsx/bun',
      'bun add vite',
      `import { dts } from 'vite-plugin-dtsx'`,
      `import { dts } from '@dtsx/vite'`,
      `import { generate } from '@dtsx/dtsx'`,
      `import { dts } from '@dtsx/dtsx/vite'`,
      `const { DtsxWebpackPlugin } = require('@dtsx/dtsx/webpack')`,
      '```diff',
      `- import { generate } from '@stacksjs/dtsx'`,
      `+ import { generate } from '@dtsx/dtsx/checker'`,
      '```',
    ].join('\n')
    expect(namedPackages(text)).toEqual(['@dtsx/vite', '@dtsx/bun', 'vite-plugin-dtsx', '@dtsx/vite', '@dtsx/dtsx', '@dtsx/dtsx', '@dtsx/dtsx', '@dtsx/dtsx'])
  })
})
