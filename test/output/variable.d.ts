import type { DtsGenerationConfig } from '@stacksjs/dtsx';
/**
* Example of const declaration
*/
export declare const conf: { [key: string]: string };
export declare let test: string;
export declare var helloWorld: string;
export declare const someObject: {
  someString: 'Stacks';
  someNumber: 1000;
  someBoolean: true;
  someFalse: false;
  someFunction: (()) => unknown;
  anotherOne: (()) => unknown;
  someArray: readonly [1, 2, 3];
  someNestedArray: readonly [readonly [1, 2, 3], Array<4 | 5 | 6 | 7 | 8 | 9 | 10>];
  someNestedArray2: readonly [readonly [1, 2, 3], Array<4 | 5 | 6 | 7 | 8 | 9 | 10>, 'dummy value'];
  someNestedArray3: Array<readonly [1, 2, 3] | Array<4 | 5 | 6 | 7 | 8 | 9 | 10> | 'dummy value' | readonly [11, 12, 13]>;
  someOtherNestedArray: readonly [Array<'some text' | 2 | unknown | (()) => unknown>, Array<4 | 5 | 6 | 7 | 8 | 9 | 10>];
  someComplexArray: readonly [readonly [{
  key: 'value'
}], readonly [{
  key2: 'value2'
}, 'test', 1000], Array<'some string' | unknown>];
  someObject: {
  key: 'value'
};
  someNestedObject: {
  key: {
  nestedKey: 'value'
};
  otherKey: {
  nestedKey: unknown;
  nestedKey2: (()) => unknown
}
};
  someNestedObjectArray: readonly [{
  key: 'value'
}, {
  key2: 'value2'
}];
  someOtherObject: unknown;
  someInlineCall2: unknown;
  someInlineCall3: unknown
};
/**
* Example of another const declaration
*
* with multiple empty lines, including being poorly formatted
*/
declare const settings: { [key: string]: any };
export declare const defaultHeaders: {
  'Content-Type': 'application/json'
};
// eslint-disable-next-line antfu/no-top-level-await
declare const dtsConfig: DtsGenerationConfig;
// Complex Arrays and Tuples
export declare const complexArrays: {
  matrix: readonly [readonly [1, 2, readonly [3, 4, readonly [5, 6]]], readonly ['a', 'b', readonly ['c', 'd']], readonly [true, readonly [false, readonly [true]]]];
  tuples: readonly [readonly [1, 'string', true], readonly ['literal', 42, false]];
  // TODO: (get this part to generate correctly
  mixedArrays: [
    new Date(),
    Promise.resolve('async'),
    async ()) => unknown
};
// Nested Object Types with Methods
export declare const complexObject: {
  handlers: {
  async onSuccess<T>(data: T): unknown;
  onError(error: Error & { code?: number }): unknown
};
  utils: {
  formatters: {
  date: ((input: Date)) => unknown;
  currency: ((amount: number, currency = 'USD')) => unknown
}
}
};
// Method Decorators and Metadata (declares as unknown, because it should rely on explicit type)
export declare const methodDecorator: ((
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
)) => unknown;
// declares as SomeType
export declare const methodDecoratorWithExplicitType: ((
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
): SomeType) => unknown;
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
  run: () => unknown;
  runSync: () => unknown
};