export declare function withCallback(cb?: (value: number) => void, attempts?: number): void;
/**
 * Constructor parameter properties: comments, defaults and arrow types.
 */
export declare class CatalogFetchError extends Error {
  public readonly url: string;
  public readonly status?: number;
  public readonly body?: string;
  constructor(url: string, message: string, status?: number, body?: string);
}
export declare class Client {
  protected readonly baseUrl: string;
  public retries: number;
  public readonly pattern: string;
  public onError: (reason?: string) => void;
  public timeout?: number;
  constructor(baseUrl: string, retries?: number, pattern?: string, onError?: (reason?: string) => void, timeout?: number);
}
