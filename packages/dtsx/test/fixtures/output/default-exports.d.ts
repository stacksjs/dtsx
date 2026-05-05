// ── 1. plain default function with a return type ──
export default function linear(): Scale;
// Regression coverage for the default-export qualifier bug.
// Each form below was previously emitted as `export declare ... X`
// (no `default`) which silently broke `import { default as Y } from
// './mod'` re-exports downstream.
export declare interface Scale {
  (x: number): number
  domain(d: number[]): Scale
}
