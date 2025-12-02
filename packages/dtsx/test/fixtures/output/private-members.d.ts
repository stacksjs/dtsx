/**
 * Test fixture for private member handling in class declarations
 * Private members should be excluded from .d.ts output
 * Modifier order should be: private/protected, static, abstract, readonly
 */
// Class with private static members - should be excluded from d.ts
export declare class CacheManager {
  static readonly MAX_SIZE: any;
  static get(key: string): unknown;
  static set(key: string, value: unknown): void;
  static clear(): void;
}
// Class with mixed visibility modifiers
export declare class MixedVisibility {
  protected protectedField: string;
  publicField: string;
  readonly readonlyField: string;
  protected static protectedStaticField: number;
  static publicStaticField: number;
  static readonly staticReadonlyField: number;
  protected protectedMethod(): void;
  publicMethod(): void;
  protected static protectedStaticMethod(): void;
  static publicStaticMethod(): void;
}
// Class with private accessors
export declare class PrivateAccessors {
  protected get protectedGetter(): number;
  protected set protectedSetter(val: number);
  get publicGetter(): number;
  set publicSetter(val: number);
}
// Class with private constructor parameter properties
export declare class ParameterProperties {
  protected protectedParam: string;
  public publicParam: string;
  readonly readonlyParam: string;
  constructor(privateParam: string, protectedParam: string, publicParam: string, readonlyParam: string);
}
// Abstract class with private members
export declare abstract class AbstractWithPrivate {
  protected abstract protectedAbstractMethod(): void;
  abstract publicAbstractMethod(): void;
}
