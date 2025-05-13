# Integration

This guide covers how to integrate dtsx with various build tools and development environments.

## Build System Integration

### Vite Integration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import dtsx from 'dtsx/vite';

export default defineConfig({
  plugins: [
    dtsx({
      // dtsx configuration
      root: './src',
      outdir: './dist',
      clean: true,
    }),
  ],
});
```

### Webpack Integration

```typescript
// webpack.config.js
const DtsxPlugin = require('dtsx/webpack');

module.exports = {
  plugins: [
    new DtsxPlugin({
      // dtsx configuration
      root: './src',
      outdir: './dist',
      clean: true,
    }),
  ],
};
```

### Rollup Integration

```typescript
// rollup.config.js
import dtsx from 'dtsx/rollup';

export default {
  plugins: [
    dtsx({
      // dtsx configuration
      root: './src',
      outdir: './dist',
      clean: true,
    }),
  ],
};
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/build.yml
name: Build
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run build
      - run: npm run generate-dts
```

### GitLab CI

```yaml
# .gitlab-ci.yml
build:
  image: node:18
  script:
    - npm install
    - npm run build
    - npm run generate-dts
```

## Custom Transformers

### Type Transformer

```typescript
interface TypeTransformer {
  // Transform type definition
  transformType(type: TypeDefinition): TypeDefinition;
  // Transform type reference
  transformReference(ref: TypeReference): TypeReference;
  // Transform type usage
  transformUsage(usage: TypeUsage): TypeUsage;
}

// Example transformer
const transformer: TypeTransformer = {
  transformType(type) {
    // Transform type definition
    return type;
  },
  transformReference(ref) {
    // Transform type reference
    return ref;
  },
  transformUsage(usage) {
    // Transform type usage
    return usage;
  },
};
```

### Import Transformer

```typescript
interface ImportTransformer {
  // Transform import statement
  transformImport(import: ImportStatement): ImportStatement;
  // Transform import usage
  transformUsage(usage: ImportUsage): ImportUsage;
  // Transform import relationships
  transformRelationships(relationships: ImportRelationships): ImportRelationships;
}

// Example transformer
const transformer: ImportTransformer = {
  transformImport(import) {
    // Transform import statement
    return import;
  },
  transformUsage(usage) {
    // Transform import usage
    return usage;
  },
  transformRelationships(relationships) {
    // Transform import relationships
    return relationships;
  },
};
```

## Plugin System

### Plugin Interface

```typescript
interface DtsxPlugin {
  // Plugin name
  name: string;
  // Plugin version
  version: string;
  // Plugin hooks
  hooks: {
    // Before processing
    beforeProcess?: (context: ProcessingContext) => void;
    // After processing
    afterProcess?: (context: ProcessingContext) => void;
    // Before type generation
    beforeTypeGeneration?: (context: TypeGenerationContext) => void;
    // After type generation
    afterTypeGeneration?: (context: TypeGenerationContext) => void;
  };
}
```

### Plugin Configuration

```typescript
interface PluginConfig {
  // Plugin name
  name: string;
  // Plugin options
  options: Record<string, unknown>;
  // Plugin dependencies
  dependencies?: string[];
  // Plugin order
  order?: number;
}
```

## Best Practices

1. **Build System Integration**
   - Use appropriate plugin
   - Configure correctly
   - Handle errors
   - Monitor performance

2. **CI/CD Integration**
   - Set up automated builds
   - Configure caching
   - Handle artifacts
   - Monitor builds

3. **Custom Transformers**
   - Keep transformers focused
   - Handle errors
   - Document transformations
   - Test thoroughly

4. **Plugin Development**
   - Follow plugin interface
   - Handle dependencies
   - Document usage
   - Test thoroughly
