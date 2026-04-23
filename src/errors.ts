export class DbError extends Error {
  override readonly name: string = 'DbError';

  constructor(
    message: string,
    public readonly cause: unknown = undefined,
  ) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}

export class ConnectionError extends DbError {
  override readonly name = 'ConnectionError';
}

export class ConstraintError extends DbError {
  override readonly name = 'ConstraintError';

  constructor(
    message: string,
    public readonly constraint: string,
    cause: unknown = undefined,
  ) {
    super(message, cause);
  }
}

export class QueryTimeoutError extends DbError {
  override readonly name = 'QueryTimeoutError';
}
