import bcrypt from 'bcryptjs';

let argon2Module: typeof import('argon2') | null | undefined = undefined;

async function getArgon2() {
  if (argon2Module !== undefined) {
    return argon2Module;
  }
  try {
    argon2Module = await import('argon2');
    return argon2Module;
  } catch {
    argon2Module = null;
    return null;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  const argon2 = await getArgon2();
  if (argon2) {
    try {
      return await argon2.hash(plain, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    } catch {
      // Fallback to bcrypt if native argon2 fails at runtime
    }
  }
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (hash.startsWith('$argon2')) {
    const argon2 = await getArgon2();
    if (!argon2) {
      return false;
    }
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
  return bcrypt.compare(plain, hash);
}
