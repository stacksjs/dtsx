import { describe, expect, test } from 'bun:test'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const describeIf = ZIG_AVAILABLE ? describe : describe.skip

function dts(source: string): string {
  return processSource(source, true).trim()
}

describeIf('Zig React component declarations', () => {
  test('retains namespace imports used by component annotations', () => {
    const output = dts(`
      import * as React from 'react'
      export interface Props { value: string }
      export const Component: React.FC<Props> = ({ value }) => <span>{value}</span>
    `)

    expect(output).toContain("import * as React from 'react';")
    expect(output).toContain('Component: React.FC<Props>;')
  })

  test('retains forwardRef imports introduced by inferred call types', () => {
    const output = dts(`
      import { forwardRef } from 'react'
      export interface InputProps { invalid?: boolean }
      export const Input = forwardRef<HTMLInputElement, InputProps>(
        ({ invalid }, ref) => <input ref={ref} aria-invalid={invalid} />
      )
    `)

    expect(output).toContain("import { forwardRef } from 'react';")
    expect(output).toContain('Input: ReturnType<typeof forwardRef<HTMLInputElement, InputProps>>;')
  })

  test('infers inline memo and lazy wrappers', () => {
    const output = dts(`
      import { lazy, memo } from 'react'
      export const Card = memo(function Card() { return <article /> })
      export const LazyPanel = lazy(() => import('./Panel'))
    `)

    expect(output).toContain("import { lazy, memo } from 'react';")
    expect(output).toContain('Card: ReturnType<typeof memo>;')
    expect(output).toContain('LazyPanel: ReturnType<typeof lazy>;')
  })

  test('emits default-exported local arrow components', () => {
    const output = dts(`
      export interface PanelProps { title: string }
      const Panel = ({ title }: PanelProps) => <section>{title}, ready</section>
      export default Panel
    `)

    expect(output).toContain('declare const Panel: ({ title }: PanelProps) => JSX.Element;')
    expect(output).toContain('export default Panel;')
  })

  test('supports semicolon props and named component wrappers', () => {
    const output = dts(`
      import { memo } from 'react'
      export interface FieldProps { value: string };
      const Field = ({ value }: FieldProps) => <span>{value}</span>
      export const MemoField = memo(Field)
    `)

    expect(output).toContain("import { memo } from 'react';")
    expect(output).toContain('MemoField: ReturnType<typeof memo>;')
  })

  test('scans nested JSX attributes without swallowing adjacent exports', () => {
    const output = dts(`
      export const Results = () => <List
        title="score > threshold"
        render={item => item.score > 0 ? <strong>{item.label}</strong> : <em>none</em>}
      />
      export const resultCount = 2
    `)

    expect(output).toContain('Results: () => JSX.Element;')
    expect(output).toContain('resultCount: 2;')
  })

  test('handles generic arrow components and custom element syntax', () => {
    const output = dts(`
      export interface CollectionProps<T> { items: T[] }
      export const Collection = <T,>({ items }: CollectionProps<T>) => <>
        <svg:path data-state="ready>pending" />
        <my-element data-count={items.length} />
      </>
    `)

    expect(output).toContain('Collection: <T,>({ items }: CollectionProps<T>) => JSX.Element;')
  })

  test('infers conditional JSX expression returns', () => {
    const output = dts('export const MaybePanel = (hidden: boolean) => hidden ? null : <section />')
    expect(output).toContain('MaybePanel: (hidden: boolean) => null | JSX.Element;')
  })

  test('preserves namespace wrappers and type-only prop imports', () => {
    const output = dts(`
      import * as React from 'react'
      import type { ExternalProps } from './types'
      const External = (props: ExternalProps) => <Widget {...props} />
      export const MemoExternal = React.memo(External)
    `)

    expect(output).toContain("import * as React from 'react';")
    expect(output).toContain('MemoExternal: ReturnType<typeof React.memo>;')
  })

  test('isolated declarations skip JSX bodies behind explicit contracts', () => {
    const output = processSource(`
      import type { FC } from 'react'
      export interface DashboardProps { title: string }
      export const Dashboard: FC<DashboardProps> = ({ title }) => (
        <DashboardShell title={\`status > \${title}\`}>
          {title.length > 0 ? <h1>{title}</h1> : null}
        </DashboardShell>
      )
      export const stable: 'yes' = 'yes'
    `, true, true)

    expect(output).toContain("import type { FC } from 'react';")
    expect(output).toContain('Dashboard: FC<DashboardProps>;')
    expect(output).toContain("stable: 'yes';")
  })

  test('emits anonymous default JSX arrows containing text punctuation', () => {
    const output = dts(`
      export interface WelcomeProps { name: string }
      export default ({ name }: WelcomeProps) => <main>Hello, {name};</main>
      export const version = '1.0.0'
    `)

    expect(output).toContain('declare const __dtsx_default_export__: ({ name }: WelcomeProps) => JSX.Element;')
    expect(output).toContain('export default __dtsx_default_export__;')
    expect(output).toContain("version: '1.0.0';")
  })
})
