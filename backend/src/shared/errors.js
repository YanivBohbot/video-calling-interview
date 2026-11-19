// Errors a service may throw. The error handler sends `status` + `{ message, ...extras }`
// to the client, so messages here must be safe to show.
export class AppError extends Error {
  constructor(status, message, extras = {}, options) {
    super(message, options);
    this.name = new.target.name;
    this.status = status;
    this.extras = extras;
  }
}

export class ValidationError extends AppError {
  constructor(message) {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message) {
    super(404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(409, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message, retryAfter) {
    super(429, message, { retryAfter });
  }
}

// Unexpected failure: the client gets the generic `message`; `cause` is only logged.
export class InternalError extends AppError {
  constructor(message, { cause } = {}) {
    super(500, message, {}, { cause });
  }
}

export class UpstreamError extends AppError {
  constructor(message, { cause } = {}) {
    super(502, message, {}, { cause });
  }
}
