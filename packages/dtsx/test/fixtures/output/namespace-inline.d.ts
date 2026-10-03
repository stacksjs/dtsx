export declare function ready(): boolean;
export declare const version: '1.0.0';
export declare abstract class Service {
  abstract start(): void;
}
// Single-line namespace bodies: a member that ends at the closing brace,
// with no semicolon or newline, must not run past it and swallow what follows.
export declare namespace Config {
  export const port: 8080;
}
export declare namespace Labels {
  export const greeting: 'hello';
}
export declare namespace Counters {
  export let hits: number;
}
export declare namespace Shapes {
  export type Kind = 'circle' | 'square'
}
export declare namespace Helpers {
  export function noop(): void;
}
export declare namespace Ambient {
  const flag: boolean;
}
