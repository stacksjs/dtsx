/**
 * Constructor parameter properties: comments, defaults and arrow types.
 */
export class CatalogFetchError extends Error {
  constructor(
    public readonly url: string,
    message: string,
    public readonly status?: number,
    /** The start of the response body, when the server sent one with an error status. */
    public readonly body?: string,
  ) {
    super(message)
  }
}

export class Client {
  constructor(
    // the server's base URL, e.g. "https://a.b", without a trailing slash
    protected readonly baseUrl: string,
    /* retries, then gives up */ public retries = 3,
    public readonly pattern: string = '/api/*',
    public onError: (reason?: string) => void = () => {},
    public timeout?: number,
  ) {}
}

export function withCallback(cb: (value: number) => void = () => {}, attempts = 2): void {
  cb(attempts)
}
