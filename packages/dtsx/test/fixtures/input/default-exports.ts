// Regression coverage for the default-export qualifier bug.
// Each form below was previously emitted as `export declare ... X`
// (no `default`) which silently broke `import { default as Y } from
// './mod'` re-exports downstream.

export interface Scale {
  (x: number): number
  domain(d: number[]): Scale
}

// ── 1. plain default function with a return type ──
export default function linear(): Scale {
  return ((x: number) => x * 2) as Scale
}

// ── 2. default async function ──
// (commented out — only one default export per file is legal in
// real TypeScript; documented here so we remember to cover it
// elsewhere)
// export default async function load(): Promise<void> {}

// ── 3. default generator function ──
// export default function* gen(): Generator<number, void, unknown> {
//   yield 1
// }
