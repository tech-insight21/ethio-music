/** Application error with an HTTP status and stable machine code. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, "bad_request", msg, details);
export const unauthorized = (msg = "Authentication required") =>
  new HttpError(401, "unauthorized", msg);
export const forbidden = (msg = "You do not have access to this resource") =>
  new HttpError(403, "forbidden", msg);
export const notFound = (msg = "Resource not found") =>
  new HttpError(404, "not_found", msg);
export const conflict = (msg: string, details?: unknown) =>
  new HttpError(409, "conflict", msg, details);
export const unprocessable = (msg: string, details?: unknown) =>
  new HttpError(422, "validation_failed", msg, details);
export const tooMany = (msg = "Too many requests, slow down") =>
  new HttpError(429, "rate_limited", msg);
