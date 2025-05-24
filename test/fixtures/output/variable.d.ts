/**
 * Example of const declaration
 */
export declare const conf: {
  apiUrl: 'https://api.stacksjs.org';
  timeout: '5000'
};
export declare let test: 'test';
export declare var helloWorld: 'Hello World';
export declare const someObject: {
  someString: 'Stacks';
  someNumber: 1000;
  someBoolean: true;
  someFalse: false;
  someFunction: () => unknown;
  anotherOne: () => unknown;
  someArray: readonly [1, 2, 3];
  someNestedArray: readonly [readonly [1, 2, 3], readonly [4, 5, 6, 7, 8, 9, 10]];
  someNestedArray2: readonly [readonly [1, 2, 3], readonly [4, 5, 6, 7, 8, 9, 10], 'dummy value'];
  someNestedArray3: readonly [readonly [1, 2, 3], readonly [4, 5, 6, 7, 8, 9, 10], 'dummy value', readonly [11, 12, 13]];
  someOtherNestedArray: readonly [readonly ['some text', 2, unknown, (() => unknown), unknown], readonly [4, 5, 6, 7, 8, 9, 10]];
  someComplexArray: readonly [readonly [{
  key: 'value'
}], readonly [{
  key2: 'value2'
}, 'test', 1000], readonly ['some string', unknown, unknown]];
  someObject: {
  key: 'value'
};
  someNestedObject: { key: { nestedKey: 'value' }; otherKey: { nestedKey: unknown; nestedKey2: () => unknown } };
  someNestedObjectArray: readonly [{
  key: 'value'
}, {
  key2: 'value2'
}];
  someOtherObject: unknown;
  someInlineCall2: unknown;
  someInlineCall3: unknown
};
export declare const defaultHeaders: {
  'Content-Type': 'application/json'
};
// Complex Arrays and Tuples
export declare const complexArrays: {
  matrix: readonly [readonly [1, 2, readonly [3, 4, readonly [5, 6]]], readonly ['a', 'b', readonly ['c', 'd']], readonly [true, readonly [false, readonly [true]]]];
  tuples: readonly [
    readonly [1, 'string', true] |
    readonly ['literal', 42, false]
  ];
  // TODO: () => unknown
};
// Nested Object Types with Methods
export declare const complexObject: {
  handlers: {
  onSuccess<T>(data: T): unknown;
  onError(error: Error & { code?: number }): unknown
};
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