export declare class CustomError extends Error {
  public readonly code: number;
  public readonly metadata: Record<string, unknown>;
  constructor(message: string, code: number, metadata: Record<string, unknown>);
}
export declare class CustomErrorWithMethod extends CustomError {
  logError(): void;
}
export declare class CustomErrorWithMethodAndType extends CustomError {
  logError(): void;
  getError(): Error;
}
export declare class CustomErrorWithMethodAndTypeAndReturn {
  public readonly code: number;
  public readonly metadata: Record<string, unknown>;
  constructor(message: string, code: number, metadata: Record<string, unknown>);
  logError(): void;
  getError(): Error;
}
export declare class Result<T, E extends Error> {
  readonly value?: T | null;
  readonly error?: E | null;
  constructor(value?: T | null, error?: E | null);
  isOk(): this is { readonly value: T };
  isErr(): this is { readonly error: E };
}
