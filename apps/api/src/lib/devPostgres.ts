import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function canConnectTcp(host: string, port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export async function ensureLocalPostgresIfNeeded(): Promise<(() => Promise<void>) | null> {
  if (env.NODE_ENV === 'production') {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(env.DATABASE_URL);
  } catch {
    return null;
  }

  const host = parsed.hostname;
  const port = Number(parsed.port || 5432);
  if (host !== 'localhost' && host !== '127.0.0.1') {
    return null;
  }

  const isRunning = await canConnectTcp(host, port);
  if (isRunning) {
    return null;
  }

  console.log(
    `[devPostgres] No external PostgreSQL detected on ${host}:${port}. Starting embedded PGlite PostgreSQL server...`
  );

  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');

  const dataDir = path.resolve(__dirname, '../../../../.pglite/unpause-dev-db');
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });

  const db = await PGlite.create(dataDir);

  const tableCheck = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'User'
    ) AS exists;`
  );

  if (!tableCheck.rows[0]?.exists) {
    const migrationPath = path.resolve(
      __dirname,
      '../../prisma/migrations/20261019000000_init/migration.sql'
    );
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await db.exec(sql);
      console.log('[devPostgres] Applied initial Prisma migration to local PGlite instance.');
    }
  }

  const server = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port,
  });

  await server.start();
  console.log(`[devPostgres] Embedded PostgreSQL listening on 127.0.0.1:${port}`);

  return async () => {
    await server.stop();
    await db.close();
  };
}
