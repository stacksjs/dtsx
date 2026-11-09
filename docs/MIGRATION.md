# Migration Guide

This guide helps you migrate from other TypeScript declaration generation tools to dtsx.

## Table of Contents

- [From @stacksjs/dtsx](#from-stacksjsdtsx)
- [From tsc --declaration](#from-tsc---declaration)
- [From dts-bundle-generator](#from-dts-bundle-generator)
- [From api-extractor](#from-api-extractor)
- [From rollup-plugin-dts](#from-rollup-plugin-dts)
- [From tsup (built-in dts)](#from-tsup-built-in-dts)
- [Common Migration Tasks](#common-migration-tasks)
- [Feature Comparison](#feature-comparison)

## From @stacksjs/dtsx

dtsx was published as `@stacksjs/dtsx` up to v0.11.36. From v0.11.37 it is published as `@dtsx/dtsx`, alongside the Vite plugin `@dtsx/vite-plugin`. Only the package name changed: the API, the `dtsx` CLI, the config file and every subpath export (`/vite`, `/esbuild`, `/tsup`, `/tsdown`, `/webpack`, `/plugins`, `/checker`) are the same.

1. Swap the dependency:

   ```bash
   bun remove @stacksjs/dtsx
   bun add -d @dtsx/dtsx
   ```

2. Update imports:

   ```diff
   - import { defineConfig, generate } from '@stacksjs/dtsx'
   + import { defineConfig, generate } from '@dtsx/dtsx'
   - import { dts } from '@stacksjs/dtsx/tsdown'
   + import { dts } from '@dtsx/dtsx/tsdown'
   ```

   A project-wide search and replace of `@stacksjs/dtsx` with `@dtsx/dtsx` covers it.

The bundler plugins (`bun-plugin-dtsx`, `esbuild-plugin-dtsx`, `tsup-plugin-dtsx`, `webpack-plugin-dtsx`, `@dtsx/vite-plugin`) depend on `@dtsx/dtsx` from v0.11.37; update them to the same version.

## From tsc --declaration

### Before (tsc)

```json
// package.json
{
  "scripts": {
    "build:types": "tsc --declaration --emitDeclarationOnly --outDir dist"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "declaration": true,
    "declarationDir": "dist",
    "emitDeclarationOnly": true
  }
}
```

### After (dtsx)

```bash
# Install
bun add @dtsx/dtsx -d
```

```json
// package.json
{
  "scripts": {
    "build:types": "dtsx generate"
  }
}
```

```typescript
// dtsx.config.ts
import { defineConfig } from '@dtsx/dtsx'

export default defineConfig({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  tsconfigPath: 'tsconfig.json',
})
```

### Key Differences

| Feature | tsc | dtsx |
|---------|-----|------|
| Speed | Slower | Faster |
| Incremental | Requires project refs | Built-in |
| Bundling | No | Yes |
| Watch mode | Basic | Advanced with debounce |
| Configuration | tsconfig.json | dtsx.config.ts |

### Migration Steps

1. Install dtsx: `bun add @dtsx/dtsx -d`
2. Create `dtsx.config.ts`
3. Update build script in `package.json`
4. Remove `declaration` options from tsconfig (optional)
5. Test output matches expected `.d.ts` files

## From dts-bundle-generator

### Before (dts-bundle-generator)

```json
// package.json
{
  "scripts": {
    "build:types": "dts-bundle-generator -o dist/index.d.ts src/index.ts"
  }
}
```

### After (dtsx)

```typescript
// dtsx.config.ts
import { defineConfig } from '@dtsx/dtsx'

export default defineConfig({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,
  bundleOutput: 'index.d.ts',
})
```

### Key Differences

| Feature | dts-bundle-generator | dtsx |
|---------|---------------------|------|
| CLI | Limited | Full-featured |
| Programmatic API | No | Yes |
| Watch mode | No | Yes |
| Incremental | No | Yes |
| Build tool plugins | No | Vite, esbuild, webpack, tsup, Bun |

### Migration Steps

1. Install dtsx
2. Create config with `bundle: true`
3. Update build script
4. Remove dts-bundle-generator dependency

## From api-extractor

### Before (api-extractor)

```json
// api-extractor.json
{
  "mainEntryPointFilePath": "<projectFolder>/dist/index.d.ts",
  "bundledPackages": [],
  "dtsRollup": {
    "enabled": true,
    "untrimmedFilePath": "<projectFolder>/dist/index.d.ts"
  }
}
```

```json
// package.json
{
  "scripts": {
    "build:types": "tsc && api-extractor run"
  }
}
```

### After (dtsx)

```typescript
// dtsx.config.ts
import { defineConfig } from '@dtsx/dtsx'

export default defineConfig({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,

  // Equivalent to api-extractor's trimming
  plugins: [{
    name: 'trim-internal',
    onDeclarations(declarations) {
      return declarations.filter(d => !d.jsdoc?.includes('@internal'))
    }
  }],
})
```

### Key Differences

| Feature | api-extractor | dtsx |
|---------|--------------|------|
| Setup complexity | High | Low |
| Configuration | JSON | TypeScript |
| Trimming | Built-in | Plugin |
| Doc generation | Yes | Via plugin |
| Speed | Slower | Faster |

### Migration Steps

1. Install dtsx
2. Create `dtsx.config.ts`
3. Add strip-internal plugin if using `@internal`
4. Update build script
5. Remove api-extractor config and dependency

### Preserving @internal Behavior

```typescript
import { defineConfig, stripInternalPlugin } from '@dtsx/dtsx'

export default defineConfig({
  plugins: [
    stripInternalPlugin(),
  ],
})
```

## From rollup-plugin-dts

### Before (rollup-plugin-dts)

```javascript
// rollup.config.js
import dts from 'rollup-plugin-dts'

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.d.ts',
    format: 'es',
  },
  plugins: [dts()],
}
```

### After (dtsx with Vite/Rollup)

```typescript
// vite.config.ts
import { dts } from '@dtsx/vite-plugin'

export default {
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
    },
  },
  plugins: [
    dts({
      bundle: true,
    }),
  ],
}
```

### Key Differences

| Feature | rollup-plugin-dts | dtsx |
|---------|------------------|------|
| Standalone usage | No | Yes |
| Vite support | Partial | Full |
| Watch mode | Basic | Advanced |
| Incremental | No | Yes |

### Migration Steps

1. Install `@dtsx/vite-plugin`
2. Update Vite/Rollup config
3. Remove rollup-plugin-dts dependency

## From tsup (built-in dts)

### Before (tsup dts)

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
})
```

### After (tsup with dtsx)

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup'
import { dtsxPlugin } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false, // Disable tsup's dts
  plugins: [
    dtsxPlugin({
      // Optional: bundle declarations
      bundle: true,
    }),
  ],
})
```

Or use the helper:

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup-plugin-dtsx'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dtsx: {
    bundle: true,
  },
})
```

### Key Differences

| Feature | tsup dts | tsup + dtsx |
|---------|----------|-------------|
| Speed | Moderate | Faster |
| Bundling | Limited | Full |
| Customization | Limited | Extensive |
| Callbacks | No | Yes |

### Migration Steps

1. Install `tsup-plugin-dtsx`
2. Add plugin to config
3. Set `dts: false` to disable tsup's built-in dts
4. Configure dtsx options as needed

## Common Migration Tasks

### Preserving Output Structure

If your previous tool generated declarations matching your source structure:

```typescript
// dtsx.config.ts
export default defineConfig({
  entrypoints: ['src/**/*.ts'],
  outdir: 'dist',
  bundle: false, // Keep separate files
})
```

### Handling Path Aliases

If you use TypeScript path aliases:

```typescript
// dtsx.config.ts
export default defineConfig({
  tsconfigPath: 'tsconfig.json', // dtsx reads paths from tsconfig
})
```

Aliases that resolve to authored sources inside the emitting package are
included in its declaration graph and written as relative output imports.
Inherited JSONC configurations retain the directory that declared their path
mappings and `baseUrl`. The same rules apply to the public Bun plugins.

Public dependency names, workspace package exports, self exports, package
imports and builtins keep their module identities. A private alias that is
missing, excluded or outside the package fails generation with its source
context. Consumer projects do not need to reproduce the source path mappings.

### Preserving JSDoc Comments

Comments are preserved by default:

```typescript
// dtsx.config.ts
export default defineConfig({
  keepComments: true, // Default
})
```

### Custom Transformations

If you had custom post-processing:

```typescript
// dtsx.config.ts
export default defineConfig({
  plugins: [{
    name: 'custom-transform',
    onDeclarations(declarations) {
      // Transform declarations
      return declarations.map(d => ({
        ...d,
        content: d.content.replace('OLD', 'NEW'),
      }))
    },
  }],
})
```

### Multiple Entry Points

```typescript
// dtsx.config.ts
export default defineConfig({
  entrypoints: [
    'src/index.ts',
    'src/utils/index.ts',
    'src/types/index.ts',
  ],
})
```

### Monorepo Support

```typescript
// dtsx.config.ts
export default defineConfig({
  workspace: {
    packages: ['packages/*'],
    shared: {
      outdir: 'dist',
    },
  },
})
```

## Feature Comparison

| Feature | tsc | dts-bundle | api-extractor | rollup-dts | tsup | dtsx |
|---------|-----|------------|---------------|------------|------|------|
| Speed | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Bundling | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Incremental | ⚠️ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Watch mode | ⚠️ | ❌ | ❌ | ⚠️ | ✅ | ✅ |
| Plugins | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| LSP | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Source maps | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Build tools | ❌ | ❌ | ❌ | Rollup | tsup | All |
| Programmatic | ⚠️ | ❌ | ⚠️ | ⚠️ | ⚠️ | ✅ |

Legend: ✅ Full support — ⚠️ Partial — ❌ None

## Troubleshooting Migration

### Output Differs from Previous Tool

1. Compare generated files side by side
2. Check for missing type exports
3. Verify import statements are correct
4. Enable `keepComments: true` if comments are missing

### Missing Types

```typescript
// Ensure all types are exported
export * from './types'
export type { MyType } from './internal'
```

### Path Resolution Issues

```typescript
// dtsx.config.ts
export default defineConfig({
  tsconfigPath: 'tsconfig.json',
  // Or specify paths directly
  paths: {
    '@/*': ['src/*'],
  },
})
```

### Performance Regression

If dtsx is slower than expected:

1. Enable incremental builds
2. Use entry points only mode
3. Check the [Performance Guide](./advanced/performance.md)

## Getting Help

If you encounter issues during migration:

1. Check the [FAQ](https://github.com/stacksjs/dtsx/wiki/FAQ)
2. Search [existing issues](https://github.com/stacksjs/dtsx/issues)
3. Open a new issue with:
    - Previous tool and version
    - dtsx version
    - Minimal reproduction
    - Expected vs actual output
