import type { User } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: string;
    }
  }
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.cookies?.[env.SESSION_COOKIE_NAME];
    if (!sessionId || typeof sessionId !== 'string') {
      throw Errors.unauthorized();
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });

    if (!session) {
      res.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
      throw Errors.unauthorized();
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await prisma.session.deleteMany({ where: { id: sessionId } });
      res.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
      throw Errors.unauthorized('Session expired. Please log in again.');
    }

    req.user = session.user;
    req.sessionId = session.id;
    next();
  } catch (err) {
    next(err);
  }
}
