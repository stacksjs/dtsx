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
})
