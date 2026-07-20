import { describe, expect, test } from 'bun:test'
import { processSource } from '../src/generator'

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
})
