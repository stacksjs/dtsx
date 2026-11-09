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

/** Package names a document tells readers to install or import. */
function namedPackages(text: string): string[] {
  // A package name: `name` or `@scope/name`, where dtsx is the scope or in the name.
  const installed = [...text.matchAll(/(?:bun add|npm install|npm i|pnpm add|yarn add)(?:\s+-[-\w]+)*\s+((?:@[\w.-]+\/)?[\w.-]+)/g)].map(match => match[1])
  const imported = [...text.matchAll(/from '((?:@[\w.-]+\/)?[\w.-]+)'/g)].map(match => match[1])
  return [...installed, ...imported].filter(name => name.startsWith('@dtsx/') || /(?:^|[-/])dtsx(?:$|-)/.test(name))
}

describe('published package names', () => {
  // npm rejects `vite-plugin-dtsx` as too similar to `vite-plugin-dts`, so the
  // Vite plugin publishes in the dtsx npm org.
  test('the Vite plugin publishes in the dtsx npm org', () => {
    expect(publishable.find(item => item.directory === 'vite-plugin')?.manifest.name).toBe('@dtsx/vite-plugin')
  })

  test.each(documents.map(path => [path.slice(repoRoot.length + 1), path]))('%s names only real workspace packages', (_label, path) => {
    for (const name of namedPackages(readFileSync(path, 'utf8')))
      expect(names.has(name) ? name : `unknown package ${name}`).toBe(name)
  })

  test('the matcher finds install and import names', () => {
    const text = [
      'bun add @dtsx/vite-plugin -d',
      'npm install --save-dev bun-plugin-dtsx',
      'bun add vite',
      `import { dts } from 'vite-plugin-dtsx'`,
      `import { dts } from '@dtsx/vite'`,
      `import { generate } from '@stacksjs/dtsx'`,
      `import { dts } from '@stacksjs/dtsx/vite'`,
    ].join('\n')
    expect(namedPackages(text)).toEqual(['@dtsx/vite-plugin', 'bun-plugin-dtsx', 'vite-plugin-dtsx', '@dtsx/vite', '@stacksjs/dtsx'])
  })
})
