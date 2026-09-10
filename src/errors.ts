/** A deliberately safe error that may be returned to the client. */
export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'AppError';
  }
}
