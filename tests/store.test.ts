import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/store.js';
import { loadConfig } from '../src/config.js';

const directories: string[] = [];
const stores: Store[] = [];
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'linkedin-store-test-'));
  directories.push(directory);
  return join(directory, 'data.sqlite');
}
function memory() {
  const store = new Store(':memory:', randomBytes(32));
  stores.push(store);
  return store;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('encrypted durable storage', () => {
  it('persists secrets without plaintext keys, namespace, or values on disk', () => {
    const path = temporary();
    const key = randomBytes(32);
    const store = new Store(path, key);
    store.set('private-alice-namespace', 'alice-provider-token', { token: 'secret-provider-value', voice: 'private-writing-preferences' });
    store.close();
    const bytes = readFileSync(path).toString('utf8');
    for (const secret of ['private-alice-namespace', 'alice-provider-token', 'secret-provider-value', 'private-writing-preferences']) expect(bytes).not.toContain(secret);
    const reopened = new Store(path, key);
    expect(reopened.get('private-alice-namespace', 'alice-provider-token')).toEqual({ token: 'secret-provider-value', voice: 'private-writing-preferences' });
    reopened.close();
    expect(() => new Store(path, randomBytes(32))).toThrow('Cannot decrypt database');
  });

  it('isolates users and deletes only the specified user namespace', () => {
    const store = memory();
    store.set('context:alice', 'voice', 'Alice voice');
    store.set('context:bob', 'voice', 'Bob voice');
    expect(store.get('context:alice', 'voice')).toBe('Alice voice');
    store.deleteNamespace('context:alice');
    expect(store.get('context:alice', 'voice')).toBeUndefined();
    expect(store.get('context:bob', 'voice')).toBe('Bob voice');
  });

  it('expires values and atomically consumes codes only once', () => {
    const store = memory();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    store.set('state', 'expired', { secret: true }, now + 100);
    store.set('state', 'live', { secret: true }, now + 1000);
    expect(store.take('state', 'live')).toEqual({ secret: true });
    expect(store.take('state', 'live')).toBeUndefined();
    clock.mockReturnValue(now + 100);
    expect(store.get('state', 'expired')).toBeUndefined();
    store.cleanup();
    expect(store.take('state', 'expired')).toBeUndefined();
  });

  it('detects ciphertext tampering instead of returning modified data', () => {
    const path = temporary();
    const key = randomBytes(32);
    const store = new Store(path, key);
    store.set('context:alice', 'voice', 'trusted');
    store.close();
    const db = new DatabaseSync(path);
    const row = db.prepare('SELECT payload FROM records').get() as { payload: Uint8Array };
    const payload = Buffer.from(row.payload);
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 1;
    db.prepare('UPDATE records SET payload = ?').run(payload);
    db.close();
    const reopened = new Store(path, key);
    expect(() => reopened.get('context:alice', 'voice')).toThrow();
    reopened.close();
  });
});

describe('configuration boundaries', () => {
  const env = () => ({
    PUBLIC_URL: 'https://agent.example.com', ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    MCP_CLIENT_ID: 'chatgpt', MCP_CLIENT_SECRET: 'x'.repeat(40),
    MCP_REDIRECT_URIS: 'https://chatgpt.com/connector/oauth/callback',
    LINKEDIN_CLIENT_ID: 'linkedin-app', LINKEDIN_CLIENT_SECRET: 'secret', LINKEDIN_API_VERSION: '202608',
  });
  it('requires explicit secrets and validates exact redirect/origin boundaries', () => {
    expect(loadConfig(env()).linkedinScopes).toEqual(['openid', 'profile']);
    expect(() => loadConfig({ ...env(), ENCRYPTION_KEY: 'secret' })).toThrow('ENCRYPTION_KEY');
    expect(() => loadConfig({ ...env(), MCP_REDIRECT_URIS: 'https://*.example.com/callback' })).toThrow('MCP_REDIRECT_URIS');
    expect(() => loadConfig({ ...env(), PUBLIC_URL: 'https://agent.example.com/path' })).toThrow('PUBLIC_URL');
    expect(() => loadConfig({ ...env(), ALLOWED_ORIGINS: 'https://chatgpt.com/path' })).toThrow('ALLOWED_ORIGINS');
    expect(() => loadConfig({ ...env(), LINKEDIN_SCOPES: 'r_invented_scope' })).toThrow('LINKEDIN_SCOPES');
    expect(() => loadConfig({ ...env(), NODE_ENV: 'production', PUBLIC_URL: 'http://localhost:3000' })).toThrow('PUBLIC_URL');
  });
});
