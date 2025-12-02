/**
 * Test fixture for private member handling in class declarations
 * Private members should be excluded from .d.ts output
 * Modifier order should be: private/protected, static, abstract, readonly
 */

// Class with private static members - should be excluded from d.ts
export class CacheManager {
  private static cache: Map<string, unknown> = new Map()
  private static loading: Map<string, Promise<unknown>> = new Map()

  static readonly MAX_SIZE = 1000

  static get(key: string): unknown {
    return this.cache.get(key)
  }

  static set(key: string, value: unknown): void {
    this.cache.set(key, value)
  }

  private static cleanup(): void {
    this.cache.clear()
  }

  static clear(): void {
    this.cleanup()
    this.loading.clear()
  }
}

// Class with mixed visibility modifiers
export class MixedVisibility {
  private privateField: string = 'private'
  protected protectedField: string = 'protected'
  public publicField: string = 'public'
  readonly readonlyField: string = 'readonly'

  private static privateStaticField: number = 0
  protected static protectedStaticField: number = 0
  public static publicStaticField: number = 0
  static readonly staticReadonlyField: number = 0

  private privateMethod(): void {}
  protected protectedMethod(): void {}
  public publicMethod(): void {}

  private static privateStaticMethod(): void {}
  protected static protectedStaticMethod(): void {}
  public static publicStaticMethod(): void {}
}

// Class with private accessors
export class PrivateAccessors {
  private _value: number = 0

  private get privateGetter(): number {
    return this._value
  }

  private set privateSetter(val: number) {
    this._value = val
  }

  protected get protectedGetter(): number {
    return this._value
  }

  protected set protectedSetter(val: number) {
    this._value = val
  }

  public get publicGetter(): number {
    return this._value
  }

  public set publicSetter(val: number) {
    this._value = val
  }
}

// Class with private constructor parameter properties
export class ParameterProperties {
  constructor(
    private privateParam: string,
    protected protectedParam: string,
    public publicParam: string,
    readonly readonlyParam: string
  ) {}
}

// Abstract class with private members
export abstract class AbstractWithPrivate {
  private privateField: string = ''
  protected abstract protectedAbstractMethod(): void
  private privateMethod(): void {}
  abstract publicAbstractMethod(): void
}
