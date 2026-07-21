import { describe, expect, test } from 'bun:test'
import { processSource } from '../src/generator'
import { processSourceIsolated } from '../src/process-source'

describe('React and JSX component declarations', () => {
  test('infers JSX returns for function components', () => {
    const output = processSource(`
      export interface ButtonProps { label: string }
      export function Button({ label }: ButtonProps) {
        return <button aria-label={label}>{label}</button>
      }
    `)

    expect(output).toContain('export declare function Button({ label }: ButtonProps): JSX.Element;')
  })

  test('infers JSX returns for arrow components', () => {
    const output = processSource(`
      export interface BadgeProps { text: string }
      export const Badge = ({ text }: BadgeProps) => <span>{text}</span>
    `)

    expect(output).toContain('export declare const Badge: ({ text }: BadgeProps) => JSX.Element;')
  })

  test('supports fragments and member component tags', () => {
    const output = processSource(`
      export const Fields = () => <><Form.Field name="email" /><Form.Field name="name" /></>
    `)

    expect(output).toContain('export declare const Fields: () => JSX.Element;')
  })

  test('unions nullable component returns', () => {
    const output = processSource(`
      export function OptionalPanel(hidden: boolean) {
        if (hidden) return null
        return <section>Visible</section>
      }
    `)

    expect(output).toContain('export declare function OptionalPanel(hidden: boolean): null | JSX.Element;')
  })

  test('preserves explicit JSX return annotations', () => {
    const output = processSource('export function Portal(): JSX.Element | null { return null }')
    expect(output).toContain('export declare function Portal(): JSX.Element | null;')
  })

  test('does not mistake angle-bracket assertions for JSX', () => {
    const output = processSource('export const value = <string>input')
    expect(output).not.toContain('value: JSX.Element')
  })

  test('preserves typed forwardRef wrappers and their imports', () => {
    const output = processSource(`
      import { forwardRef } from 'react'
      export interface InputProps { invalid?: boolean }
      export const Input = forwardRef<HTMLInputElement, InputProps>(
        ({ invalid }, ref) => <input ref={ref} aria-invalid={invalid} />
      )
    `)

    expect(output).toContain("import { forwardRef } from 'react';")
    expect(output).toContain('Input: ReturnType<typeof forwardRef<HTMLInputElement, InputProps>>;')
  })

  test('preserves memo wrappers around inline components', () => {
    const output = processSource(`
      import { memo } from 'react'
      export interface CardProps { title: string }
      export const Card = memo(function Card({ title }: CardProps) {
        return <article>{title}</article>
      })
    `)

    expect(output).toContain("import { memo } from 'react';")
    expect(output).toContain('Card: ReturnType<typeof memo>;')
  })

  test('preserves lazy wrappers around dynamic imports', () => {
    const output = processSource(`
      import { lazy } from 'react'
      export const LazyPanel = lazy(() => import('./Panel'))
    `)

    expect(output).toContain("import { lazy } from 'react';")
    expect(output).toContain('LazyPanel: ReturnType<typeof lazy>;')
  })

  test('keeps explicit component contracts on the isolated path', () => {
    const output = processSourceIsolated(`
      import type { FC } from 'react'
      export interface GreetingProps { name: string }
      export const Greeting: FC<GreetingProps> = ({ name }) => <div>{name}</div>
    `, 'Greeting.tsx')

    expect(output).toContain("import type { FC } from 'react';")
    expect(output).toContain('Greeting: FC<GreetingProps>;')
  })

  test('emits local arrow components referenced by default exports', () => {
    const output = processSource(`
      export interface PanelProps { title: string }
      const Panel = ({ title }: PanelProps) => <section>{title}, ready</section>
      export default Panel
    `)

    expect(output).toContain('declare const Panel: ({ title }: PanelProps) => JSX.Element;')
    expect(output).toContain('export default Panel;')
  })

  test('stops JSX initializers before following exports', () => {
    const output = processSource(`
      export const Header = () => <header>Hello, world</header>
      export const footerLabel = 'Footer'
    `)

    expect(output).toContain('Header: () => JSX.Element;')
    expect(output).toContain("footerLabel: 'Footer';")
  })

  test('supports semicolon-terminated props followed by components', () => {
    const output = processSource(`
      export interface ButtonProps { label: string };
      export const Button = ({ label }: ButtonProps) => <button>{label}</button>
    `)

    expect(output).toContain('Button: ({ label }: ButtonProps) => JSX.Element;')
  })

  test('infers wrappers around named and nested components', () => {
    const output = processSource(`
      import { forwardRef, memo } from 'react'
      export interface FieldProps { value: string };
      const Field = ({ value }: FieldProps) => <span>{value}</span>
      export const MemoField = memo(Field)
      export const RefField = memo(forwardRef<HTMLDivElement, FieldProps>(
        (props, ref) => <div ref={ref}>{props.value}</div>
      ))
    `)

    expect(output).toContain("import { memo } from 'react';")
    expect(output).not.toContain('forwardRef')
    expect(output).toContain('MemoField: ReturnType<typeof memo>;')
    expect(output).toContain('RefField: ReturnType<typeof memo>;')
  })

  test('handles generic components and class components', () => {
    const output = processSource(`
      import * as React from 'react'
      export interface ListProps<T> { items: T[]; render: (item: T) => React.ReactNode };
      export function List<T>({ items, render }: ListProps<T>) {
        return <ul>{items.map(render)}</ul>
      }
      export class Boundary extends React.Component<{ children?: React.ReactNode }> {
        render() { return <section>{this.props.children}</section> }
      }
    `)

    expect(output).toContain("import * as React from 'react';")
    expect(output).toContain('function List<T>({ items, render }: ListProps<T>): JSX.Element;')
    expect(output).toContain('class Boundary extends React.Component<{ children?: React.ReactNode }>')
    expect(output).toContain('render(): JSX.Element;')
  })

  test('scans nested JSX attributes containing comparisons and tag delimiters', () => {
    const output = processSource(`
      export const Results = () => (
        <List
          title="score > threshold"
          render={item => item.score > 0 ? <strong>{item.label}</strong> : <em>none</em>}
        />
      )
      export const resultCount = 2
    `)

    expect(output).toContain('Results: () => JSX.Element;')
    expect(output).toContain('resultCount: 2;')
  })

  test('infers unparenthesized JSX bodies containing callback props', () => {
    const output = processSource(`
      export const InlineResults = () => <List
        render={item => item.visible ? <strong>{item.label}</strong> : null}
      />
    `)

    expect(output).toContain('InlineResults: () => JSX.Element;')
  })

  test('handles generic arrow components without treating type parameters as JSX', () => {
    const output = processSource(`
      export interface CollectionProps<T> { items: T[] }
      export const Collection = <T,>({ items }: CollectionProps<T>) => (
        <ul>{items.map(item => <li>{String(item)}</li>)}</ul>
      )
    `)

    expect(output).toContain('Collection: <T,>({ items }: CollectionProps<T>) => JSX.Element;')
  })

  test('supports custom elements, namespaced tags, spreads, and JSX comments', () => {
    const output = processSource(`
      export const Graphic = (props: Record<string, unknown>) => <>
        {/* an embedded comment with ; , and > */}
        <svg:path {...props} data-state="ready>pending" />
        <my-element data-id="custom" />
      </>
    `)

    expect(output).toContain('Graphic: (props: Record<string, unknown>) => JSX.Element;')
  })

  test('infers conditional JSX expression returns', () => {
    const output = processSource(`
      export const MaybePanel = (hidden: boolean) => hidden ? null : <section />
    `)

    expect(output).toContain('MaybePanel: (hidden: boolean) => null | JSX.Element;')
  })

  test('emits anonymous default arrow components and following declarations', () => {
    const output = processSource(`
      export interface WelcomeProps { name: string }
      export default ({ name }: WelcomeProps) => <main>Hello, {name};</main>
      export const version = '1.0.0'
    `)

    expect(output).toContain('declare const __dtsx_default_export__: ({ name }: WelcomeProps) => JSX.Element;')
    expect(output).toContain('export default __dtsx_default_export__;')
    expect(output).toContain("version: '1.0.0';")
  })

  test('preserves React namespace imports used by member wrappers', () => {
    const output = processSource(`
      import * as React from 'react'
      export interface LabelProps { value: string }
      const Label = ({ value }: LabelProps) => <span>{value}</span>
      export const MemoLabel = React.memo(Label)
      export const RefLabel = React.forwardRef<HTMLSpanElement, LabelProps>(
        ({ value }, ref) => <span ref={ref}>{value}</span>
      )
    `)

    expect(output).toContain("import * as React from 'react';")
    expect(output).toContain('MemoLabel: ReturnType<typeof React.memo>;')
    expect(output).toContain('RefLabel: ReturnType<typeof React.forwardRef<HTMLSpanElement, LabelProps>>;')
  })

  test('keeps type-only prop imports referenced by emitted component signatures', () => {
    const output = processSource(`
      import type { ExternalProps } from './types'
      export const External = (props: ExternalProps) => <Widget {...props} />
    `)

    expect(output).toContain("import type { ExternalProps } from './types';")
    expect(output).toContain('External: (props: ExternalProps) => JSX.Element;')
  })

  test('isolated declarations skip complex JSX bodies behind explicit contracts', () => {
    const output = processSourceIsolated(`
      import type { FC } from 'react'
      export interface DashboardProps { title: string }
      export const Dashboard: FC<DashboardProps> = ({ title }) => (
        <DashboardShell title={\`status > \${title}\`}>
          {title.length > 0 ? <h1>{title}</h1> : null}
        </DashboardShell>
      )
      export const stable: 'yes' = 'yes'
    `, 'Dashboard.tsx')

    expect(output).toContain("import type { FC } from 'react';")
    expect(output).toContain('Dashboard: FC<DashboardProps>;')
    expect(output).toContain("stable: 'yes';")
  })

  test('does not classify incomplete JSX or comparison expressions as elements', () => {
    const output = processSource(`
      export const lower = left < right
      export const malformed = '<Panel>'
    `)

    expect(output).not.toContain('lower: JSX.Element')
    expect(output).not.toContain('malformed: JSX.Element')
  })
})
