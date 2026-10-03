import { createApp } from './app.js';
import { env, envLoadMeta, getDatabaseConnectionMeta } from './lib/env.js';
import { deriveDueNotifications } from './lib/notifications.js';
import { initializeStorage } from './lib/storage/index.js';

const app = createApp();

await initializeStorage();

app.listen(env.PORT, () => {
  const db = getDatabaseConnectionMeta(env.DATABASE_URL);
  const loaded = envLoadMeta.loadedEnvFiles.length > 0 ? envLoadMeta.loadedEnvFiles.join(', ') : 'none';
  console.log(`API listening on http://localhost:${env.PORT}`);
  console.log(`[env] loaded: ${loaded} | database: ${db.host}:${db.port}/${db.database}`);
});

if (env.NOTIFICATION_SCAN_INTERVAL_MS > 0 && env.NODE_ENV !== 'test') {
  const scanner = setInterval(() => {
    void deriveDueNotifications().catch((error: unknown) => {
      console.error('Due notification scan failed', error);
    });
  }, env.NOTIFICATION_SCAN_INTERVAL_MS);
  scanner.unref();
}
