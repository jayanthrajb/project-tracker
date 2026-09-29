import { createApp } from './app.js';
import { env, envLoadMeta, getDatabaseConnectionMeta } from './lib/env.js';

const app = createApp();

app.listen(env.PORT, () => {
  const db = getDatabaseConnectionMeta(env.DATABASE_URL);
  const loaded = envLoadMeta.loadedEnvFiles.length > 0 ? envLoadMeta.loadedEnvFiles.join(', ') : 'none';
  console.log(`API listening on http://localhost:${env.PORT}`);
  console.log(`[env] loaded: ${loaded} | database: ${db.host}:${db.port}/${db.database}`);
});
