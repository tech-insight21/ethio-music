import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

/**
 * Zod validation middleware. Parsed (and coerced) values replace the raw
 * ones, so handlers only ever see validated data.
 */
export function validate(schemas: {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) (req as Request).params = schemas.params.parse(req.params);
      if (schemas.query) (req as Request).query = schemas.query.parse(req.query);
      if (schemas.body) (req as Request).body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      next(err); // ZodError → 422 in the error handler
    }
  };
}
