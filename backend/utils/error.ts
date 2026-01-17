export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ErrorResponse {
  error: {
    message: string;
    code: ErrorCode;
    report?: {
      github: string;
    };
  };
}

export class GeneralError extends Error {
  public readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode = ErrorCode.INTERNAL_ERROR) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, GeneralError.prototype);
  }

  getStatus(): number {
    if (this instanceof BadRequest) return 400;
    if (this instanceof Unauthorized) return 401;
    if (this instanceof Forbidden) return 403;
    if (this instanceof NotFound) return 404;
    if (this instanceof Conflict) return 409;
    if (this instanceof TooManyRequests) return 429;
    if (this instanceof ValidationError) return 400;
    return 500;
  }

  toJSON(): ErrorResponse {
    return {
      error: {
        message: this.message,
        code: this.code,
      },
    };
  }
}

export class BadRequest extends GeneralError {
  constructor(message: string) {
    super(message, ErrorCode.BAD_REQUEST);
    Object.setPrototypeOf(this, BadRequest.prototype);
  }
}

export class Unauthorized extends GeneralError {
  constructor(message: string = 'Unauthorized') {
    super(message, ErrorCode.UNAUTHORIZED);
    Object.setPrototypeOf(this, Unauthorized.prototype);
  }
}

export class Forbidden extends GeneralError {
  constructor(message: string) {
    super(message, ErrorCode.FORBIDDEN);
    Object.setPrototypeOf(this, Forbidden.prototype);
  }
}

export class NotFound extends GeneralError {
  constructor(message: string) {
    super(message, ErrorCode.NOT_FOUND);
    Object.setPrototypeOf(this, NotFound.prototype);
  }
}

export class Conflict extends GeneralError {
  constructor(message: string) {
    super(message, ErrorCode.CONFLICT);
    Object.setPrototypeOf(this, Conflict.prototype);
  }
}

export class TooManyRequests extends GeneralError {
  constructor(message: string) {
    super(message, ErrorCode.TOO_MANY_REQUESTS);
    Object.setPrototypeOf(this, TooManyRequests.prototype);
  }
}

export class ValidationError extends GeneralError {
  constructor(message: string) {
    super(message, ErrorCode.VALIDATION_ERROR);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
