import { createApp } from './app.js';
import { env } from './config/env.js';
import { ensureLocalPostgresIfNeeded } from './lib/devPostgres.js';

async function bootstrap() {
  await ensureLocalPostgresIfNeeded();
  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`Unpause API listening on port ${env.PORT} (${env.NODE_ENV})`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start Unpause API server:', err);
  process.exit(1);
});
