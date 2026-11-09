# @dtsx/tsdown

A [tsdown](https://tsdown.dev) plugin that generates your declarations with dtsx: narrow inferred types, `@defaultValue` docs, and no `isolatedDeclarations` requirement.

## Installation

```bash
bun add @dtsx/tsdown -d
# or
npm install @dtsx/tsdown --save-dev
```

## Usage

```typescript
// tsdown.config.ts
import { defineConfig } from 'tsdown'
import { dts } from '@dtsx/tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  plugins: [dts()],
})
```

The plugin turns off tsdown's own `dts` step and writes one declaration file next to each entry chunk, with the same name and format extension (`index.d.mts` beside `index.mjs`). tsdown keeps ownership of entries, output names and cleaning.

## Options

`dts()` takes the dtsx generation options except the ones tsdown owns (`entrypoints`, `outdir`, `bundle`, `bundleOutput`, `clean`, `dryRun`, `outputStructure`, `declarationMap`):

```typescript
dts({
  root: './src',
  keepComments: true,
  moduleSpecifierMode: 'node',
})
```

## License

MIT
