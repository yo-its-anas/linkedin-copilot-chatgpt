import { loadConfig } from './config.js';
import { Store } from './store.js';
import { AuthService } from './auth.js';
import { LinkedInClient } from './linkedin.js';
import { ToolService } from './tools.js';
import { createApp } from './server.js';

const config = loadConfig();
const store = new Store(config.databasePath, config.encryptionKey);
const auth = new AuthService(config, store);
const client = new LinkedInClient(config, auth);
const tools = new ToolService(config, store, auth, client);
const app = createApp(config, store, auth, tools);
const server = app.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`${JSON.stringify({ event: 'started', port: config.port, transport: 'streamable-http' })}\n`);
});
const cleanup = setInterval(() => store.cleanup(), 60_000);
cleanup.unref();
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(cleanup);
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
