# Declaration diagnostic coverage

The maintained compiler is TypeScript 7.0.2. Its published package identifies
[`microsoft/typescript-go@2bd066d87f5bafd315be9f40889d0a60b9e58e0b`](https://github.com/microsoft/typescript-go/tree/2bd066d87f5bafd315be9f40889d0a60b9e58e0b)
as `gitHead`. Diagnostic eligibility is tied to that release, rather than assumed
from a catalog number or a different compiler implementation.

The 34 catalog rows have three different roles:

| Role | Codes | Maintained evidence |
| --- | --- | --- |
| Active primary diagnostics | 9007–9013, 9015–9023, 9025–9026, 9037–9039 | 21 strict-valid source fixtures; actual isolated declaration emit must report exactly the corresponding file/code pairs. |
| Related suggestions | 9027–9036 | These are attached to primary failures, rather than 10 independent failing-source profiles. The pinned compiler's [suggestion dispatcher](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/transformers/declarations/diagnostics.go#L469) describes their role. |
| Catalog only in this release's declaration emitter | 9005–9006 | The messages remain in the [generated catalog](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/diagnostics/diagnostics_generated.go#L3545), with no emission call sites in the pinned compiler's source. No unrelated source is labeled as reproducing them. |
| Ineligible as a strict-valid source fixture | 9014 | Non-entity computed names in interfaces/type literals fail strict source checking with 1169/1170. The maintained eligibility test requires those exact errors. |

For 9014, the [grammar check](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/grammarchecks.go#L1408)
rejects non-entity dynamic names: the compiler's
[late-bindable syntax predicate](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/checker/checker.go#L19895)
requires the same entity-name syntax that the
[declaration transformer](https://github.com/microsoft/typescript-go/blob/2bd066d87f5bafd315be9f40889d0a60b9e58e0b/internal/transformers/declarations/transform.go#L577)
would otherwise diagnose. Producing a 9014 failure from already-invalid source
would not demonstrate successful declaration generation.

For 9025, a literal default before a required parameter is accepted by this
compiler. The real fixture uses an inferred call default:

```ts
export function read(first = Math.abs(-1), last: number): number {
  return first + last
}
```

Strict source checking accepts it. Isolated declaration emit reports TS9025.
The installed declarations must accept `read(undefined, 2)` and reject a string
argument with exactly TS2345.

## Public contract checks

[`declaration-diagnostics.test.ts`](../packages/dtsx/test/declaration-diagnostics.test.ts)
uses the sources and independent positive/negative consumers in
[`declaration-diagnostics.json`](../packages/dtsx/test/fixtures/declaration-diagnostics.json).
Every active primary has a public contract; the catalog classification assertion
prevents omitted, duplicated or relabeled rows.

Each producer must pass strict authored-source and ordinary TypeScript reference
controls before its output is checked. Core, the Bun plugin, native FFI with real
project contexts, and the native project CLI each produce an actual package with
21 exported subpaths. The suite packs and installs it normally and with the
frozen lockfile, verifies installed declaration bytes, and checks all contracts
with `strict: true`, `skipLibCheck: false`, empty `paths`, and no ambient types.
All negative modules must report their exact expected diagnostics at their own
files; positive modules and declarations must be clean.

These strict programs also reject parser errors in generated declarations.
Absence of a TS9xxx error from a declaration-only `noEmit` check is insufficient:
the actual isolated source oracle and the public type contracts are separate
requirements. No compiler replacement, consumer annotation repair, diagnostic
suppression, retry or increased test deadline is used.

The individual regression suites add broader controls for call inference, local
return scopes, class expression identities, literal widening, destructuring,
function properties and augmentation activation. The matrix supplements them.
When the compiler version changes, a changed diagnostic needs new eligibility
evidence and preserved public contracts before this classification changes.

Tracked by [#3098](https://github.com/stacksjs/dtsx/issues/3098); owning source
fixes include [#3165](https://github.com/stacksjs/dtsx/issues/3165),
[#3166](https://github.com/stacksjs/dtsx/issues/3166),
[#3167](https://github.com/stacksjs/dtsx/issues/3167),
[#3168](https://github.com/stacksjs/dtsx/issues/3168),
[#3169](https://github.com/stacksjs/dtsx/issues/3169), and
[#3170](https://github.com/stacksjs/dtsx/issues/3170).
