export class RuntimeError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'RuntimeError'
    this.code = code
    this.details = details
  }
}

export function isRuntimeError(error: unknown): error is RuntimeError {
  return error instanceof RuntimeError
}