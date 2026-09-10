import { cpSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { validatePlugin, repository } from './validate-plugin.mjs';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--production') options.production = true;
  else if (['--url', '--app-id', '--publisher', '--website', '--privacy', '--terms'].includes(key) && args[i + 1]) options[key.slice(2)] = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${key}`);
}
const endpoint = new URL(options.url ?? 'http://localhost:3000/mcp');
if (endpoint.pathname !== '/mcp' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error('--url must be an exact /mcp endpoint without credentials, query or fragment.');
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && endpoint.hostname === 'localhost')) throw new Error('Remote MCP URLs require HTTPS.');
if (options['app-id'] && !/^(plugin_asdk_app|connector_)[A-Za-z0-9_-]+$/.test(options['app-id'])) throw new Error('Use the actual registered OpenAI technical app ID.');
if (options.production) {
  if (endpoint.protocol !== 'https:' || /(^|\.)(localhost|example|test|invalid)$|(^|\.)example\.(com|org|net)$/.test(endpoint.hostname)) throw new Error('Production packaging requires the real public HTTPS endpoint.');
  for (const key of ['app-id', 'publisher', 'website', 'privacy', 'terms']) if (!options[key]) throw new Error(`Production packaging requires --${key}.`);
  for (const key of ['website', 'privacy', 'terms']) {
    const url = new URL(options[key]);
    if (url.protocol !== 'https:' || url.username || url.password || /(^|\.)(example|test|invalid)$|(^|\.)example\.(com|org|net)$/.test(url.hostname)) throw new Error(`--${key} must be a real public HTTPS URL.`);
  }
}
validatePlugin();
const release = resolve(repository, 'release');
mkdirSync(release, { recursive: true });
const output = mkdtempSync(join(release, options.production ? 'production-' : 'development-'));
const folder = join(output, 'linkedin-copilot-chatgpt');
mkdirSync(folder);
// Explicit allowlist excludes environment files, credentials, database, caches and dependencies.
for (const path of ['plugin.json', 'mcp.json', '.mcp.json', '.app.json', '.codex-plugin', 'skills', 'user-profile', 'LICENSE', 'README.md', 'MIGRATION.md', 'ARCHITECTURE.md', 'SECURITY.md', 'docs']) {
  cpSync(join(repository, path), join(folder, path), { recursive: true, filter: source => !source.endsWith('.pyc') && !source.includes('__pycache__') });
}
const json = path => JSON.parse(readFileSync(join(folder, path), 'utf8'));
const save = (path, value) => writeFileSync(join(folder, path), `${JSON.stringify(value, null, 2)}\n`);
const manifest = json('plugin.json');
const overlay = json('.codex-plugin/plugin.json');
const portable = json('mcp.json');
const compatibility = json('.mcp.json');
portable.mcpServers['linkedin-copilot-chatgpt'].url = endpoint.href;
compatibility.mcpServers['linkedin-copilot-chatgpt'].url = endpoint.href;
if (options['app-id']) {
  save('.app.json', { apps: { 'linkedin-copilot-chatgpt': { id: options['app-id'], required: false } } });
  manifest.extensions['com.openai'].apps = './.app.json';
  overlay.apps = './.app.json';
  // A registered app mapping supplies this connection in ChatGPT; avoid a duplicate connection.
  portable.mcpServers = {};
  compatibility.mcpServers = {};
}
for (const target of [manifest.extensions['com.openai'].interface, overlay.interface]) {
  if (options.publisher) target.developerName = options.publisher;
  if (options.website) target.websiteURL = options.website;
  if (options.privacy) target.privacyPolicyURL = options.privacy;
  if (options.terms) target.termsOfServiceURL = options.terms;
}
if (options.publisher) { manifest.author = { name: options.publisher }; overlay.author = { name: options.publisher }; }
save('plugin.json', manifest); save('.codex-plugin/plugin.json', overlay); save('mcp.json', portable); save('.mcp.json', compatibility);
validatePlugin(folder);
const files = {};
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not permitted in plugin archives.');
    if (entry.isDirectory()) walk(path);
    else files[relative(output, path).replaceAll('\\', '/')] = new Uint8Array(readFileSync(path));
  }
}
walk(folder);
const archive = join(output, 'linkedin-copilot-chatgpt.zip');
writeFileSync(archive, zipSync(files, { level: 6 }));
console.log(JSON.stringify({ archive, folder, mode: options.production ? 'production candidate (requires review)' : 'development', registeredApp: Boolean(options['app-id']), files: Object.keys(files).length }, null, 2));
