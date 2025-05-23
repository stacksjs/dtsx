export declare class CustomError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly metadata: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CustomError'
  }
}
export declare class CustomErrorWithMethod extends CustomError {
  logError() {
    console.error(`[${this.code}] ${this.message}`)
  }
}
export declare class CustomErrorWithMethodAndType extends CustomError {
  logError(): void {
    console.error(`[${this.code}] ${this.message}`)
  }

  getError(): Error {
    return this
  }
}
export declare class CustomErrorWithMethodAndTypeAndReturn {
  constructor(
    private message: string,
    public readonly code: number,
    public readonly metadata: Record<string, unknown>
  ) {
    this.message = message
    this.code = code
    this.metadata = metadata
  }

  logError(): void {
    console.error(`[${this.code}] ${this.message}`)
  }

  getError(): Error {
    return new Error(this.message)
  }
}
export declare class Result<T, E extends Error> {
  constructor(
    readonly value: T | null = null,
    readonly error: E | null = null
  ) {}

  isOk(): this is { readonly value: T } {
    return this.value !== null && this.error === null;
  }

  isErr(): this is { readonly error: E } {
    return this.error !== null && this.value === null;
  }
}