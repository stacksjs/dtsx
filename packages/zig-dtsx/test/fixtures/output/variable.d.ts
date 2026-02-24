/**
 * Example of const declaration
 */
export declare const conf: {
  apiUrl: 'https://api.stacksjs.org';
  timeout: '5000'
};
/** @defaultValue 'test' */
export declare let test: string;
/** @defaultValue 'Hello World' */
export declare var helloWorld: string;
/**
 * @defaultValue
 * ```ts
 * {
 *   someString: 'Stacks',
 *   someNumber: 1000,
 *   someBoolean: true,
 *   someFalse: false,
 *   someFunction: () => unknown,
 *   anotherOne: () => unknown,
 *   someArray: [1, 2, 3],
 *   someNestedArray: [ [1, 2, 3], [4, 5, 6, 7, 8, 9, 10], ],
 *   someNestedArray2: [ [1, 2, 3], [4, 5, 6, 7, 8, 9, 10], 'dummy value', ],
 *   someNestedArray3: [ [1, 2, 3], [4, 5, 6, 7, 8, 9, 10], 'dummy value', [11, 12, 13], ],
 *   someObject: { key: 'value' },
 *   someNestedObject: { key: { nestedKey: 'value' }, otherKey: { nestedKey2: () => unknown } },
 *   someNestedObjectArray: [ { key: 'value' }, { key2: 'value2' }, ]
 * }
 * ```
 */
export declare const someObject: {
  /** @defaultValue 'Stacks' */
  someString: string;
  /** @defaultValue 1000 */
  someNumber: number;
  /** @defaultValue true */
  someBoolean: boolean;
  /** @defaultValue false */
  someFalse: boolean;
  someFunction: () => unknown;
  anotherOne: () => unknown;
  someArray: number[];
  someNestedArray: number[][];
  someNestedArray2: (number[] | string)[];
  someNestedArray3: (number[] | string)[];
  someOtherNestedArray: ((string | number | unknown | (() => unknown))[] | number[])[];
  someComplexArray: ({
  /** @defaultValue 'value' */
  key: string
}[] | ({
  /** @defaultValue 'value2' */
  key2: string
} | string | number)[] | (string | unknown)[])[];
  someObject: {
  /** @defaultValue 'value' */
  key: string
};
  someNestedObject: { key: { /** @defaultValue 'value' */ nestedKey: string }; otherKey: { nestedKey: unknown; nestedKey2: () => unknown } };
  someNestedObjectArray: ({
  /** @defaultValue 'value' */
  key: string
} | {
  /** @defaultValue 'value2' */
  key2: string
})[];
  someOtherObject: unknown;
  someInlineCall2: unknown;
  someInlineCall3: unknown
};
/** @defaultValue `{ 'Content-Type': 'application/json' }` */
export declare const defaultHeaders: {
  /** @defaultValue 'application/json' */
  'Content-Type': string
};
/**
 * Complex Arrays and Tuples
 * @defaultValue
 * ```ts
 * {
 *   matrix: [ [1, 2, [3, 4, [5, 6]]], ['a', 'b', ['c', 'd']], [true, [false, [true]]], ],
 *   tuples: [ [1, 'string', true] as const, ['literal', 42, false] as const, ]
 * }
 * ```
 */
export declare const complexArrays: {
  matrix: ((number | (number | number[])[])[] | (string | string[])[] | (boolean | (boolean | boolean[])[])[])[];
  tuples: readonly [
    readonly [1, 'string', true] |
    readonly ['literal', 42, false]
  ];
  mixedArrays: (Date | Promise<string> | (() => unknown) | (() => Generator<any, any, any>))[]
};
/**
 * Nested Object Types with Methods
 * @defaultValue
 * ```ts
 * {
 *   handlers: {
 *     onSuccess<T>: (data: T) => unknown,
 *     onError: (error: Error & { code?: number }) => unknown,
 *     someOtherMethod: () => unknown
 *   },
 *   utils: {
 *     formatters: {
 *       date: (input: Date) => unknown,
 *       currency: (amount: number, currency?) => unknown
 *     }
 *   }
 * }
 * ```
 */
export declare const complexObject: {
  handlers: { onSuccess<T>: (data: T) => unknown; onError: (error: Error & { code?: number }) => unknown; someOtherMethod: () => unknown };
  utils: { formatters: { date: (input: Date) => unknown; currency: (amount: number, currency?) => unknown } }
};
// Method Decorators and Metadata (declares as unknown, because it should rely on explicit type)
export declare const methodDecorator: (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) => unknown;
// declares as SomeType
export declare const methodDecoratorWithExplicitType: (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) => SomeType;
// Complex Constants with Type Inference
export declare const CONFIG_MAP: {
  development: {
  features: {
  auth: {
  providers: readonly ['google', 'github'];
  settings: {
  timeout: 5000;
  retries: 3
}
}
}
};
  production: {
  features: {
  auth: {
  providers: readonly ['google', 'github', 'microsoft'];
  settings: {
  timeout: 3000;
  retries: 5
}
}
}
}
};
export declare const command: {
  run: unknown;
  runSync: unknown
};
