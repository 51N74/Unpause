import { Router } from 'express';
import { env } from '../config/env.js';
import { serializeUser } from '../lib/serializers.js';
import { getSessionCookieOptions, requireAuth } from '../middleware/auth.js';
import {
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '../schemas/validation.js';
import {
  loginUser,
  logoutSession,
  registerUser,
  updateUserDisplayName,
} from '../services/auth.service.js';

export const authRouter = Router();

authRouter.post('/auth/register', async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const { user, sessionId } = await registerUser(input);
    res.cookie(env.SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions());
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const { user, sessionId } = await loginUser(input);
    res.cookie(env.SESSION_COOKIE_NAME, sessionId, getSessionCookieOptions());
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/auth/logout', async (req, res, next) => {
  try {
    const sessionId = req.cookies?.[env.SESSION_COOKIE_NAME];
    await logoutSession(typeof sessionId === 'string' ? sessionId : undefined);
    res.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    res.status(200).json({ user: serializeUser(req.user!) });
  } catch (err) {
    next(err);
  }
});

const handleUpdateProfile = async (
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction
) => {
  try {
    const input = updateProfileSchema.parse(req.body);
    const user = await updateUserDisplayName(req.user!.id, input.displayName);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
};

authRouter.patch('/users/me', requireAuth, handleUpdateProfile);
authRouter.put('/users/me', requireAuth, handleUpdateProfile);
