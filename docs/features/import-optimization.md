# Import Optimization

dtsx provides sophisticated import optimization capabilities to ensure your declaration files are clean and efficient.

## Smart Import Tracking

dtsx tracks imports in several ways:

- Type imports (`import type`)
- Value imports (`import`)
- Mixed imports
- Default imports
- Namespace imports

## Import Optimization Strategies

### Type-Only Imports

```typescript
// Before optimization
import { User, UserRole, processUser } from './types';

// After optimization
import type { User, UserRole } from './types';
import { processUser } from './types';
```

### Unused Import Removal

```typescript
// Before optimization
import { User, Role, Permission } from './types';
// Only User is used in the file

// After optimization
import { User } from './types';
```

### Import Consolidation

```typescript
// Before optimization
import { User } from './types';
import { Role } from './types';
import { Permission } from './types';

// After optimization
import { User, Role, Permission } from './types';
```

## Import Tracking Features

### Type Usage Tracking

- Tracks all type references
- Maintains type relationships
- Handles type aliases
- Supports type augmentation

### Value Usage Tracking

- Tracks function calls
- Tracks variable usage
- Handles destructuring
- Supports namespace usage

## Optimization Rules

1. **Type-Only Rule**: Imports used only as types are converted to type imports
2. **Unused Removal Rule**: Unused imports are removed
3. **Consolidation Rule**: Multiple imports from the same module are consolidated
4. **Namespace Rule**: Namespace imports are optimized based on usage
5. **Default Import Rule**: Default imports are handled appropriately

## Configuration Options

```typescript
interface ImportOptimizationConfig {
  // Enable/disable import optimization
  optimizeImports: boolean;

  // Keep certain imports even if unused
  preserveImports: string[];

  // Custom import transformation rules
  transformRules: ImportTransformRule[];
}
```

## Best Practices

1. Use type imports for type-only usage
2. Avoid mixing type and value imports when possible
3. Use namespace imports for large modules
4. Keep related imports together
5. Use consistent import styles
