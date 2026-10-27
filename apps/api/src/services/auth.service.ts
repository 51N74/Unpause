import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { Errors } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import { serializeUser } from '../lib/serializers.js';

function createSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function getSessionExpiry(): Date {
  return new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName?: string;
}) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existing) {
    throw Errors.conflict('An account with this email already exists.');
  }

  const passwordHash = await hashPassword(input.password);
  const fallbackName = input.email.split('@')[0] || 'Developer';
  const displayName = (input.displayName?.trim() || fallbackName).slice(0, 80);
  const sessionId = createSessionToken();
  const expiresAt = getSessionExpiry();

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        displayName,
      },
    });

    await tx.session.create({
      data: {
        id: sessionId,
        userId: createdUser.id,
        expiresAt,
      },
    });

    return createdUser;
  });

  return {
    user: serializeUser(user),
    sessionId,
  };
}

export async function loginUser(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });

  if (!user) {
    throw Errors.unauthorized('Invalid email or password.');
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    throw Errors.unauthorized('Invalid email or password.');
  }

  const sessionId = createSessionToken();
  const expiresAt = getSessionExpiry();

  await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      expiresAt,
    },
  });

  return {
    user: serializeUser(user),
    sessionId,
  };
}

export async function logoutSession(sessionId?: string) {
  if (!sessionId) return;
  await prisma.session.deleteMany({
    where: { id: sessionId },
  });
}

export async function updateUserDisplayName(userId: string, displayName: string) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { displayName: displayName.trim() },
  });
  return serializeUser(user);
}
