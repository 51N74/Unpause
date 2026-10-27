import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const errorId = crypto.randomUUID();

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    res.status(400).json({
      error: {
        id: errorId,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        id: errorId,
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Handle malformed JSON body
  if (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status?: number }).status === 400
  ) {
    res.status(400).json({
      error: {
        id: errorId,
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON request body',
      },
    });
    return;
  }

  // Log only safe metadata (never stack traces in response, never secrets/passwords/sessionIds)
  if (process.env.NODE_ENV !== 'test') {
    const safeMessage =
      err instanceof Error ? err.message : 'Unexpected internal error';
    console.error(`[Error ${errorId}] ${safeMessage}`);
  }

  res.status(500).json({
    error: {
      id: errorId,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred.',
    },
  });
}
