/**
 * Test fixture for private member handling in class declarations
 * Private members should be excluded from .d.ts output
 * Modifier order should be: private/protected, static, abstract, readonly
 */
// Class with private static members - should be excluded from d.ts
export declare class CacheManager {
  private static cache;
  private static loading;
  static readonly MAX_SIZE: 1000;
  static get(key: string): unknown;
  static set(key: string, value: unknown): void;
  private static cleanup;
  static clear(): void;
}
// Class with mixed visibility modifiers
export declare class MixedVisibility {
  private privateField;
  protected protectedField: string;
  publicField: string;
  readonly readonlyField: string;
  private static privateStaticField;
  protected static protectedStaticField: number;
  static publicStaticField: number;
  static readonly staticReadonlyField: number;
  private privateMethod;
  protected protectedMethod(): void;
  publicMethod(): void;
  private static privateStaticMethod;
  protected static protectedStaticMethod(): void;
  static publicStaticMethod(): void;
}
// Class with private accessors
export declare class PrivateAccessors {
  private _value;
  private privateGetter;
  private privateSetter;
  protected get protectedGetter(): number;
  protected set protectedSetter(val: number);
  get publicGetter(): number;
  set publicSetter(val: number);
}
// Class with private constructor parameter properties
export declare class ParameterProperties {
  private privateParam;
  protected protectedParam: string;
  public publicParam: string;
  readonly readonlyParam: string;
  constructor(privateParam: string, protectedParam: string, publicParam: string, readonlyParam: string);
}
// Abstract class with private members
export declare abstract class AbstractWithPrivate {
  private privateField;
  protected abstract protectedAbstractMethod(): void;
  private privateMethod;
  abstract publicAbstractMethod(): void;
}
