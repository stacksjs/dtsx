export declare interface RequestMarkers {
  traceId: string
}
export declare interface RequestMacros {
  user: () => Promise<unknown>
}
export type RequestExtensions = RequestMarkers & RequestMacros;
/**
 * An interface that extends inside a `declare module` block (#3103).
 */
declare module '@stacksjs/bun-router' {
  interface EnhancedRequest extends RequestExtensions {}
  interface MultiParent extends RequestMarkers, RequestMacros {
  locale: string
}
  interface Generic<T> extends Array<T> { first: T }
  interface Braced extends Pick<{ a: string, b: number }, 'a'> { c: boolean }
}
