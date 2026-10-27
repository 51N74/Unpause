import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createCorsMiddleware(allowedOrigins: string[] = env.CORS_ORIGINS) {
  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like same-origin, curl, or server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(Errors.invalidOrigin());
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });
}

export function createOriginValidationMiddleware(
  allowedOrigins: string[] = env.CORS_ORIGINS
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) {
        next(Errors.invalidOrigin());
        return;
      }
    }
    next();
  };
}
