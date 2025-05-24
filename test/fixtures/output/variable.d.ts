export declare const conf: { [key: string]: string };
export declare let test: 'test';
export declare var helloWorld: 'Hello World';
export declare const someObject: {
  someString: 'Stacks';
  someNumber: number;
  someBoolean: boolean;
  someFalse: boolean;
  someFunction: () => unknown;
  anotherOne: () => unknown;
  someArray: Array<number>;
  someNestedArray: Array<Array<number>>;
  someNestedArray2: Array<Array<number> | 'dummy value'>;
  someNestedArray3: Array<Array<number> | 'dummy value'>;
  someOtherNestedArray: Array<Array<'some text' | number | unknown | (() => unknown)> | Array<number>>;
  someComplexArray: Array<Array<{
  key: 'value'
}> | Array<{
  key2: 'value2'
} | 'test' | number> | Array<'some string' | unknown>>;
  someObject: {
  key: 'value'
};
  someNestedObject: {
  key: {
  nestedKey: 'value'
};
  otherKey: {
  nestedKey: unknown;
  nestedKey2: () => unknown
}
};
  someNestedObjectArray: Array<{
  key: 'value'
} | {
  key2: 'value2'
}>;
  someOtherObject: unknown;
  someInlineCall2: unknown;
  someInlineCall3: unknown
};
export declare const defaultHeaders: {
  'Content-Type': 'application/json'
};
export declare const complexArrays: {
  matrix: readonly [readonly [1, 2, readonly [3, 4, readonly [5, 6]]], readonly ['a', 'b', readonly ['c', 'd']], readonly [true, readonly [false, readonly [true]]]];
  tuples: readonly [
    readonly [1, 'string', true] |
    readonly ['literal', 42, false]
  ];
  // TODO: () => any
};
export declare const complexObject: {
  handlers: {
  async onSuccess<T>(data: T): unknown;
  onError(error: Error & { code?: number }): unknown
};
  utils: {
  formatters: {
  date: (input: Date) => unknown;
  currency: (amount: number, currency = 'USD') => any
}
}
};
export declare const methodDecorator: (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) => any;
export declare const methodDecoratorWithExplicitType: (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) => any;
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