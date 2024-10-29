import type { DtsGenerationConfig } from '@stacksjs/dtsx';

/**
 * Example of const declaration
 */
export declare const conf: { [key: string]: string };
export declare let test = 'test'
export declare var helloWorld = 'Hello World'
export declare const someObject: {
  someString: 'Stacks';
  someNumber: 1000;
  someBoolean: true;
  someFalse: false;
  someFunction: (...args: any[]) => unknown;
  anotherOne: (...args: any[]) => unknown;
  someArray: Array<1 | 2 | 3>;
  someNestedArray: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10>>;
  someNestedArray2: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10> | 'dummy value'>;
  someNestedArray3: Array<Array<1 | 2 | 3> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10> | 'dummy value' | Array<11 | 12 | 13>>;
  someOtherNestedArray: Array<Array<'some text' | 2 | unknown | ((...args: any[]) => unknown)> | Array<4 | 5 | 6 | 7 | 8 | 9 | 10>>;
  someComplexArray: Array<Array<{ key: 'value' }> | Array<{ key2: 'value2' } | 'test' | 1000> | Array<'some string' | unknown>>;
  someObject: {
    key: 'value';
  };
  someNestedObject: {
    key: {
      nestedKey: 'value';
    };
    otherKey: {
      nestedKey: () => void;
      nestedKey2: (...args: any[]) => unknown;
    };
  };
};
/**
 * Example of another const declaration
    *
* with multiple empty lines, including being poorly formatted
 */
declare const settings: { [key: string]: any };
export declare const defaultHeaders: {
  'Content-Type': 'application/json';
};
declare const dtsConfig: DtsGenerationConfig;
export declare const complexArrays: {
  matrix: Array<Array<1 | 2 | Array<3 | 4 | Array<5 | 6>>> | Array<'a' | 'b' | Array<'c' | 'd'>> | Array<true | Array<false | Array<true>>>>;
  tuples: Array<Array<1 | 'string' | true> | Array<'literal' | 42 | false>>;
};
