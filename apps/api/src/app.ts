import cookieParser from 'cookie-parser';
import express from 'express';
import { Errors } from './lib/errors.js';
import { errorHandler } from './middleware/errorHandler.js';
import {
  createCorsMiddleware,
  createOriginValidationMiddleware,
} from './middleware/security.js';
import { authRouter } from './routes/auth.routes.js';
import { githubRouter } from './routes/github.routes.js';
import { projectsRouter } from './routes/projects.routes.js';

export function createApp(allowedOrigins?: string[]) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(createCorsMiddleware(allowedOrigins));
  app.use(createOriginValidationMiddleware(allowedOrigins));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/v1', authRouter);
  app.use('/api/v1', projectsRouter);
  app.use('/api/v1', githubRouter);

  app.use((_req, _res, next) => {
    next(Errors.notFound('API endpoint not found'));
  });

  app.use(errorHandler);

  return app;
}
