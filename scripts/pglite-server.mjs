import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.argv[2] || 5432);
const mode = process.argv[3] || 'memory'; // 'memory' or 'persist'

async function main() {
  let db;
  if (mode === 'persist') {
    const dataDir = path.resolve(__dirname, '../.pglite/unpause-dev-db');
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    db = await PGlite.create(dataDir);
  } else {
    db = await PGlite.create();
  }

  const server = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port,
  });

  await server.start();
  process.stdout.write(`PGLITE_READY:${port}\n`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await Promise.race([
        server.stop(),
        new Promise((resolve) => setTimeout(resolve, 150)),
      ]);
      await db.close();
    } catch {
      // ignore close errors
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start PGlite socket server:', err);
  process.exit(1);
});
