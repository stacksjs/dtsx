// @ts-nocheck
import process from 'node:process'
import type { DtsGenerationConfig } from '@stacksjs/dtsx'

/**
 * Example of const declaration
 */
export const conf: { [key: string]: string } = {
  apiUrl: 'https://api.stacksjs.org',
  timeout: '5000', // as string
}

export let test = 'test'

export var helloWorld = 'Hello World'

export const someObject = {
  someString: 'Stacks',
  someNumber: 1000,
  someBoolean: true,
  someFalse: false,
  someFunction: () => { console.log('hello world') },
  anotherOne: () => {
    // some comment
    /* some other comment */
    return some.object ?? 'default'
  },
  someArray: [1, 2, 3],
  someNestedArray: [
    [1, 2, 3],
    [4, 5, 6, 7, 8, 9, 10],
  ],
  someNestedArray2: [
    [1, 2, 3],
    [4, 5, 6, 7, 8, 9, 10],
    'dummy value',
  ],
  someNestedArray3: [
    [1, 2, 3],
    [4, 5, 6, 7, 8, 9, 10],
    'dummy value',
    [11, 12, 13],
  ],
  someOtherNestedArray: [
    [
      'some text',
      2,
      console.log,
      () => console.log('hello world'),
      helloWorld,
    ],
    [4, 5, 6, 7, 8, 9, 10],
  ],
  someComplexArray: [
    [
      { key: 'value' },
    ],
    [
      { key2: 'value2' },
      'test',
      1000,
    ],
    [
      'some string',
      console.log,
      someFunction(),
    ]
  ],
  someObject: { key: 'value' },
  someNestedObject: {
    key: {
      nestedKey: 'value',
    },
    otherKey: {
      nestedKey: process.cwd(),
      nestedKey2: () => { console.log('hello world') },
    }
  },
  someNestedObjectArray: [
    { key: 'value' },
    { key2: 'value2' },
  ],
  someOtherObject: some.deep.object,
  someInlineCall2: console.log,
  someInlineCall3: console.log(),
}

/**
 * Example of another const declaration
    *
* with multiple empty lines, including being poorly formatted
 */
const settings: { [key: string]: any } = {
  theme: 'dark',
  language: 'en',
}

export const defaultHeaders = {
  'Content-Type': 'application/json',
}

// eslint-disable-next-line antfu/no-top-level-await
const dtsConfig: DtsGenerationConfig = await loadConfig({
  name: 'dts',
  cwd: process.cwd(),
  defaultConfig: {
    cwd: process.cwd(),
    root: './src',
    entrypoints: ['**/*.ts'],
    outdir: './dist',
    keepComments: true,
    clean: true,
    tsconfigPath: './tsconfig.json',
  },
})

// Complex Arrays and Tuples
export const complexArrays = {
  matrix: [
    [1, 2, [3, 4, [5, 6]]],
    ['a', 'b', ['c', 'd']],
    [true, [false, [true]]],
  ],
  tuples: [
    [1, 'string', true] as const,
    ['literal', 42, false] as const,
  ],
  // TODO: get this part to generate correctly
  mixedArrays: [
    new Date(),
    Promise.resolve('async'),
    async () => 'result',
    function* generator() { yield 42 },
  ]
}

// Nested Object Types with Methods
export const complexObject = {
  handlers: {
    async onSuccess<T>(data: T): Promise<void> {
      console.log(data)
    },
    onError(error: Error & { code?: number }): never {
      throw error
    },
    someOtherMethod() {
      // some body
    }
  },
  utils: {
    formatters: {
      date: (input: Date) => input.toISOString(),
      currency: (amount: number, currency = 'USD') =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
    }
  }
}

// TODO: Method Decorators and Metadata
// export const methodDecorator = (
//   target: any,
//   propertyKey: string,
//   descriptor: PropertyDescriptor
// ) => {
//   return {
//     ...descriptor,
//     enumerable: true,
//   }
// }

// TODO: Complex Constants with Type Inference
// export const CONFIG_MAP = {
//   development: {
//     features: {
//       auth: {
//         providers: ['google', 'github'] as const,
//         settings: { timeout: 5000, retries: 3 }
//       }
//     }
//   },
//   production: {
//     features: {
//       auth: {
//         providers: ['google', 'github', 'microsoft'] as const,
//         settings: { timeout: 3000, retries: 5 }
//       }
//     }
//   }
// } as const
