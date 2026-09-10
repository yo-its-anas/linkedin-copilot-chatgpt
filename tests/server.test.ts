import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server.js';
import { AuthService } from '../src/auth.js';
import { Store } from '../src/store.js';
import { ToolService } from '../src/tools.js';
import { LinkedInClient } from '../src/linkedin.js';
import type { Config } from '../src/config.js';
const config: Config = {
  publicUrl: 'http://localhost:3000', port: 3000, databasePath: ':memory:', encryptionKey: randomBytes(32).toString('base64'),
  mcpClientId: 'test-client', mcpClientSecret: 's'.repeat(40), redirectUris: ['https://chatgpt.com/test/callback'],
  linkedinClientId: 'provider-client', linkedinClientSecret: 'provider-secret', linkedinScopes: ['openid', 'profile', 'w_member_social'],
  linkedinApiVersion: '202608', allowedOrigins: ['http://localhost:3000', 'https://chatgpt.com'], nodeEnv: 'test',
};
let store: Store;
let app: ReturnType<typeof createApp>;
let provider: ReturnType<typeof vi.fn>;
beforeEach(() => {
  store = new Store(':memory:', config.encryptionKey);
  provider = vi.fn(async () => { throw new Error('No network calls expected'); });
  const auth = new AuthService(config, store, provider);
  const client = new LinkedInClient(config, auth, provider);
  app = createApp(config, store, auth, new ToolService(config, store, auth, client, () => {}));
});
afterEach(() => { store.close(); });
const rpc = (method: string, params: Record<string, unknown> = {}) => request(app).post('/mcp').set('Host', 'localhost:3000').set('Accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method, params });
describe('remote MCP HTTP contract', () => {
  it('initializes official Streamable HTTP transport', async () => {
    const response = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }).expect(200);
    expect(response.body.result.serverInfo.name).toBe('linkedin-copilot-chatgpt');
    expect(response.body.result.capabilities.tools).toBeDefined();
  });
  it('discovers tools without provider credentials and includes host approval metadata', async () => {
    const response = await rpc('tools/list').expect(200);
    const post = response.body.result.tools.find((tool: any) => tool.name === 'linkedin_create_post');
    expect(post.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    expect(post.securitySchemes[0].scopes).toEqual(['linkedin:write']);
    expect(provider).not.toHaveBeenCalled();
  });
  it('serves workflow instructions in a chat without prompting for account access', async () => {
    const response = await rpc('tools/call', { name: 'linkedin_get_workflow', arguments: { workflow: 'linkedin-plan' } }).expect(200);
    expect(response.body.result.structuredContent.result.instructions).toContain('name: linkedin-plan');
    expect(response.body.result._meta?.['mcp/www_authenticate']).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();
  });
  it('returns tool-level OAuth linking information for anonymous private reads', async () => {
    const response = await rpc('tools/call', { name: 'linkedin_get_my_profile', arguments: {} }).expect(200);
    expect(response.body.result.isError).toBe(true);
    expect(response.body.result._meta['mcp/www_authenticate'][0]).toContain('oauth-protected-resource');
    expect(provider).not.toHaveBeenCalled();
  });
  it('rejects invalid bearer tokens with resource discovery', async () => {
    const response = await rpc('tools/list').set('Authorization', 'Bearer invalid').expect(401);
    expect(response.headers['www-authenticate']).toContain('oauth-protected-resource');
  });
  it('publishes matching authorization/resource metadata', async () => {
    const response = await request(app).get('/.well-known/oauth-protected-resource').set('Host', 'localhost:3000').expect(200);
    expect(response.body.resource).toBe('http://localhost:3000/mcp');
    expect(response.body.authorization_servers).toEqual(['http://localhost:3000']);
  });
  it('rejects DNS rebinding hosts and untrusted browser origins', async () => {
    await request(app).get('/health').set('Host', 'attacker.example').expect(400);
    await rpc('tools/list').set('Origin', 'https://attacker.example').expect(403);
  });
  it('bounds request bodies and sanitizes malformed JSON', async () => {
    const huge = await request(app).post('/mcp').set('Host', 'localhost:3000').send({ value: 'x'.repeat(70000) }).expect(413);
    expect(JSON.stringify(huge.body)).not.toContain('xxxxx');
    await request(app).post('/mcp').set('Host', 'localhost:3000').set('Content-Type', 'application/json').send('{bad').expect(400);
  });
  it('makes health checks private-data-free and does not expose GET sessions', async () => {
    const response = await request(app).get('/ready').set('Host', 'localhost:3000').expect(200);
    expect(response.body).toEqual({ status: 'ready' });
    const unsupported = await request(app).get('/mcp').set('Host', 'localhost:3000').expect(405);
    expect(unsupported.headers.allow).toBe('POST');
  });
});
