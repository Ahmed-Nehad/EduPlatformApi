/**
 * Application error with an HTTP status and a machine-readable `code`.
 *
 * Thrown from controllers/services and normalized by the global error
 * handler into `{ success: false, error: { code, message } }`.
 */
export class AppError extends Error {
  public readonly status: number
  public readonly code: string
  public readonly details?: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
    Object.setPrototypeOf(this, AppError.prototype)
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new AppError(400, code, message, details)
  }

  static unauthorized(code = 'UNAUTHORIZED', message = 'Authentication required') {
    return new AppError(401, code, message)
  }

  static forbidden(code = 'FORBIDDEN', message = 'You do not have access') {
    return new AppError(403, code, message)
  }

  static notFound(code = 'NOT_FOUND', message = 'Resource not found') {
    return new AppError(404, code, message)
  }

  static conflict(code: string, message: string, details?: unknown) {
    return new AppError(409, code, message, details)
  }
}

export default AppError
