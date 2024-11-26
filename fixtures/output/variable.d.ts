import type { DtsGenerationConfig } from '@stacksjs/dtsx';

export declare const conf: { [key: string]: string };
export declare let test: 'test';
export declare var helloWorld: 'Hello World';
export declare const someObject: {
  someString: 'Stacks';
  someNumber: 1000;
  someBoolean: true;
  someFalse: false;
  someFunction: () => unknown;
  anotherOne: () => unknown;
  someArray: Array<1 | 2 | 3>;
  someNestedArray: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10>>;
  someNestedArray2: Array<
    Array<1 | 2 | 3> |
    Array<4 | 5 | 6 | 7 | 8 | 9 | 10> |
    'dummy value'
  >;
  someNestedArray3: Array<
    Array<1 | 2 | 3> |
    Array<4 | 5 | 6 | 7 | 8 | 9 | 10> |
    'dummy value' |
    Array<11 | 12 | 13>
  >;
  someOtherNestedArray: Array<
    Array<'some text' | 2 | unknown | (() => unknown) | unknown> |
    Array<4 | 5 | 6 | 7 | 8 | 9 | 10>
  >;
  someComplexArray: Array<
    Array<{
        key: 'value'
      }> |
    Array<{
        key2: 'value2'
      } | 'test' | 1000> |
    Array<'some string' | unknown | unknown>
  >;
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
  someNestedObjectArray: Array<
    {
      key: 'value'
    } |
    {
      key2: 'value2'
    }
  >;
  someOtherObject: unknown;
  someInlineCall2: unknown;
  someInlineCall3: unknown
};
declare const settings: { [key: string]: any };
export declare const defaultHeaders: {
  'Content-Type': 'application/json'
};
declare const dtsConfig: DtsGenerationConfig;
export declare const complexArrays: {
  matrix: Array<
    Array<1 | 2 | Array<3 | 4 | Array<5 | 6>>> |
    Array<'a' | 'b' | Array<'c' | 'd'>> |
    Array<true | Array<false | Array<true>>>
  >;
  tuples: readonly [
    readonly [1, 'string', true] |
    readonly ['literal', 42, false]
  ];
  mixedArrays: Array<
    unknown |
    unknown |
    ((...args: any[]) => unknown) |
    ((...args: any[]) => unknown)
  >
};
export declare const complexObject: {
  handlers: {
    onSuccess: <T> (data: T) => Promise<void>;
    onError: (error: Error & { code?: number }) => void
  };
  utils: {
    formatters: {
      date: (input: Date) => unknown;
      currency: (amount: number, currency) => unknown
    }
  }
};
export declare const methodDecorator: (target: any, propertyKey: string, descriptor: PropertyDescriptor) => unknown;
export declare const methodDecoratorWithExplicitType: (target: any, propertyKey: string, descriptor: PropertyDescriptor) => SomeType;
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
  Readable, Readable>, Error>> => {
    return await runCommand: () => unknown
};