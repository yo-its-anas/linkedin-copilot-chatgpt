import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, type Account } from '../src/auth.js';
import type { Config } from '../src/config.js';
import { Store } from '../src/store.js';

const verifier = 'a'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const redirectUri = 'https://chatgpt.com/connector/oauth/callback';
const config: Config = {
  publicUrl: 'http://localhost:3000', port: 3000, databasePath: ':memory:',
  encryptionKey: randomBytes(32).toString('base64'), mcpClientId: 'chatgpt-client',
  mcpClientSecret: 'local-test-secret-with-at-least-32-characters', redirectUris: [redirectUri],
  linkedinClientId: 'linkedin-client', linkedinClientSecret: 'linkedin-test-secret',
  linkedinScopes: ['openid', 'profile', 'w_member_social', 'r_member_social', 'r_liteprofile'],
  linkedinApiVersion: '202608', allowedOrigins: ['http://localhost:3000'], nodeEnv: 'test',
};
const resource = `${config.publicUrl}/mcp`;
const tokenBody = (code: string) => ({
  client_id: config.mcpClientId, client_secret: config.mcpClientSecret,
  grant_type: 'authorization_code', code, redirect_uri: redirectUri,
  code_verifier: verifier, resource,
});

let store: Store;
let auth: AuthService;
let app: ReturnType<typeof express>;
let provider: ReturnType<typeof vi.fn<typeof fetch>>;

function setup(overrides: Partial<Config> = {}) {
  provider = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/accessToken')) {
      const body = new URLSearchParams(String(init?.body));
      const subject = body.get('code') ?? 'refreshed';
      return new Response(JSON.stringify({ access_token: `${subject}-provider-secret`, expires_in: 3600 }), { status: 200 });
    }
    const headers = new Headers(init?.headers);
    const subject = headers.get('Authorization')?.replace('Bearer ', '').replace('-provider-secret', '') ?? 'unknown';
    if (url.endsWith('/userinfo')) return new Response(JSON.stringify({ sub: subject, name: 'Sample Member' }), { status: 200 });
    if (new URL(url).pathname.endsWith('/me')) return new Response(JSON.stringify({ id: `person-${subject}` }), { status: 200 });
    throw new Error('Unexpected provider request');
  });
  auth = new AuthService({ ...config, ...overrides }, store, provider);
  app = express();
  auth.mount(app);
}

async function begin(scopes = 'linkedin:read linkedin:write context:write') {
  const browser = request.agent(app);
  const page = await browser.get('/authorize').query({
    client_id: config.mcpClientId, redirect_uri: redirectUri, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256',
    state: 'chatgpt-state', resource, scope: scopes,
  }).expect(200);
  const requestId = /name="request_id" value="([^"]+)"/.exec(page.text)![1]!;
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)![1]!;
  return { browser, requestId, csrf, page };
}

async function upstream(scopes?: string) {
  const flow = await begin(scopes);
  const consent = await flow.browser.post('/authorize').type('form').send({ request_id: flow.requestId, csrf: flow.csrf, decision: 'allow' }).expect(302);
  const url = new URL(consent.headers.location);
  return { ...flow, url, state: url.searchParams.get('state')! };
}

async function connect(subject = 'alice', scopes?: string) {
  const flow = await upstream(scopes);
  const callback = await flow.browser.get('/oauth/linkedin/callback').query({ state: flow.state, code: subject }).expect(302);
  const result = new URL(callback.headers.location);
  expect(result.searchParams.get('error')).toBeNull();
  expect(result.searchParams.get('state')).toBe('chatgpt-state');
  const code = result.searchParams.get('code')!;
  return { ...flow, code };
}

async function login(subject = 'alice', scopes?: string) {
  const flow = await connect(subject, scopes);
  const response = await request(app).post('/token').type('form').send(tokenBody(flow.code)).expect(200);
  return { ...flow, tokens: response.body as { access_token: string; refresh_token: string; scope: string }, session: auth.authenticate(response.body.access_token) };
}

beforeEach(() => { store = new Store(':memory:', config.encryptionKey); setup(); });
afterEach(() => { vi.restoreAllMocks(); store.close(); });

describe('OAuth discovery and consent', () => {
  it('advertises the exact protected resource, S256, and confidential client grants', async () => {
    const discovery = await request(app).get('/.well-known/oauth-authorization-server').expect(200);
    expect(discovery.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(discovery.body.registration_endpoint).toBeUndefined();
    expect(discovery.body.token_endpoint_auth_methods_supported).toContain('client_secret_basic');
    const metadata = await request(app).get('/.well-known/oauth-protected-resource/mcp').expect(200);
    expect(metadata.body.resource).toBe(resource);
  });

  it.each([
    { client_id: 'attacker' }, { redirect_uri: `${redirectUri}.attacker.example` },
    { resource: 'https://other.example/mcp' }, { code_challenge_method: 'plain' },
    { code_challenge: 'short' }, { scope: 'linkedin:admin' }, { response_type: 'token' },
  ])('rejects invalid authorization boundaries: %j', async overrides => {
    const response = await request(app).get('/authorize').query({
      client_id: config.mcpClientId, redirect_uri: redirectUri, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', state: 'state', resource, scope: 'linkedin:read', ...overrides,
    }).expect(400);
    expect(response.headers.location).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();
  });

  it('requires explicit browser-bound consent and a one-use CSRF transaction', async () => {
    const flow = await begin('context:write');
    expect(provider).not.toHaveBeenCalled();
    await request(app).post('/authorize').type('form').send({ request_id: flow.requestId, csrf: flow.csrf, decision: 'allow' }).expect(400);
    await flow.browser.post('/authorize').type('form').send({ request_id: flow.requestId, csrf: 'wrong', decision: 'allow' }).expect(400);
    const response = await flow.browser.post('/authorize').type('form').send({ request_id: flow.requestId, csrf: flow.csrf, decision: 'allow' }).expect(302);
    expect(new URL(response.headers.location).searchParams.get('scope')).toBe('openid profile');
    await flow.browser.post('/authorize').type('form').send({ request_id: flow.requestId, csrf: flow.csrf, decision: 'allow' }).expect(400);
  });

  it('supports cancel without initiating upstream authorization', async () => {
    const flow = await begin();
    const response = await flow.browser.post('/authorize').type('form').send({ request_id: flow.requestId, csrf: flow.csrf, decision: 'deny' }).expect(302);
    expect(new URL(response.headers.location).searchParams.get('error')).toBe('access_denied');
    expect(provider).not.toHaveBeenCalled();
  });

  it('binds LinkedIn state to the browser and consumes it before token exchange', async () => {
    const flow = await upstream();
    await request(app).get('/oauth/linkedin/callback').query({ state: flow.state, code: 'alice' }).expect(400);
    await flow.browser.get('/oauth/linkedin/callback').query({ state: 'wrong-state', code: 'alice' }).expect(400);
    await flow.browser.get('/oauth/linkedin/callback').query({ state: flow.state, code: 'alice' }).expect(302);
    const calls = provider.mock.calls.length;
    await flow.browser.get('/oauth/linkedin/callback').query({ state: flow.state, code: 'alice' }).expect(400);
    expect(provider.mock.calls).toHaveLength(calls);
  });

  it('expires browser authorization transactions', async () => {
    const flow = await upstream();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    await flow.browser.get('/oauth/linkedin/callback').query({ state: flow.state, code: 'alice' }).expect(400);
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('broker token authorization', () => {
  it('returns only opaque broker tokens and resolves Person ID independently of OIDC subject', async () => {
    const flow = await login();
    expect(flow.tokens.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(flow.tokens)).not.toContain('provider-secret');
    expect(auth.getAccount(flow.session.userId)).toMatchObject({ subject: 'alice', memberId: 'person-alice', accessToken: 'alice-provider-secret' });
    expect(await auth.getLinkedInToken(flow.session.userId)).toBe('alice-provider-secret');
    await request(app).post('/token').type('form').send(tokenBody(flow.code)).expect(400);
  });

  it('does not invent a Person ID from the OIDC subject without a profile API grant', async () => {
    setup({ linkedinScopes: ['openid', 'profile', 'w_member_social'] });
    const flow = await login();
    expect(auth.getAccount(flow.session.userId).memberId).toBeUndefined();
    expect(provider.mock.calls.some(([url]) => new URL(String(url)).pathname.endsWith('/me'))).toBe(false);
  });

  it.each([
    { code_verifier: 'b'.repeat(64) }, { redirect_uri: 'https://attacker.example/callback' },
    { resource: 'https://attacker.example/mcp' }, { client_secret: 'wrong-secret' },
  ])('rejects invalid token exchange: %j', async overrides => {
    const flow = await connect();
    const response = await request(app).post('/token').type('form').send({ ...tokenBody(flow.code), ...overrides });
    expect(response.status).toBe(overrides.client_secret ? 401 : 400);
    expect(response.body.access_token).toBeUndefined();
  });

  it('supports HTTP Basic client authentication with S256 and resource binding', async () => {
    const flow = await connect();
    const { client_secret: _secret, client_id: _id, ...body } = tokenBody(flow.code);
    const response = await request(app).post('/token').auth(config.mcpClientId, config.mcpClientSecret).type('form').send(body).expect(200);
    expect(auth.authenticate(response.body.access_token).scopes).toContain('linkedin:read');
  });

  it('expires authorization codes and broker access tokens', async () => {
    const flow = await login();
    const codeFlow = await connect('bob');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    expect(() => auth.authenticate(flow.tokens.access_token)).toThrow('expired or revoked');
    await request(app).post('/token').type('form').send(tokenBody(codeFlow.code)).expect(400);
  });

  it('rotates refresh tokens and revokes the entire family on refresh replay', async () => {
    const flow = await login();
    const body = { client_id: config.mcpClientId, client_secret: config.mcpClientSecret, grant_type: 'refresh_token', resource, refresh_token: flow.tokens.refresh_token };
    const rotated = await request(app).post('/token').type('form').send(body).expect(200);
    expect(rotated.body.refresh_token).not.toBe(flow.tokens.refresh_token);
    expect(auth.authenticate(rotated.body.access_token).userId).toBe(flow.session.userId);
    await request(app).post('/token').type('form').send(body).expect(400);
    expect(() => auth.authenticate(rotated.body.access_token)).toThrow('expired or revoked');
    expect(() => auth.authenticate(flow.tokens.access_token)).toThrow('expired or revoked');
  });

  it('allows refresh scope reduction and forbids scope expansion', async () => {
    const flow = await login('alice', 'linkedin:read context:write');
    const body = { client_id: config.mcpClientId, client_secret: config.mcpClientSecret, grant_type: 'refresh_token', resource, refresh_token: flow.tokens.refresh_token };
    await request(app).post('/token').type('form').send({ ...body, scope: 'linkedin:write' }).expect(400);
    const reduced = await request(app).post('/token').type('form').send({ ...body, scope: 'linkedin:read' }).expect(200);
    expect(auth.authenticate(reduced.body.access_token).scopes).toEqual(['linkedin:read']);
  });

  it('revokes issued token families and gives indistinguishable success for unknown tokens', async () => {
    const flow = await login();
    const body = { client_id: config.mcpClientId, client_secret: config.mcpClientSecret };
    await request(app).post('/revoke').type('form').send({ ...body, token: flow.tokens.access_token }).expect(200);
    expect(() => auth.authenticate(flow.tokens.access_token)).toThrow('expired or revoked');
    await request(app).post('/revoke').type('form').send({ ...body, token: randomBytes(32).toString('base64url') }).expect(200);
  });

  it('disconnects one user, clears their context, and invalidates old tokens after reconnect', async () => {
    const alice = await login();
    const bob = await login('bob');
    expect(alice.session.userId).not.toBe(bob.session.userId);
    store.set(`context:${alice.session.userId}`, 'voice', 'Alice private voice');
    store.set(`context:${bob.session.userId}`, 'voice', 'Bob private voice');
    auth.disconnect(alice.session.userId);
    expect(() => auth.getAccount(alice.session.userId)).toThrow('Connect your LinkedIn account');
    expect(() => auth.authenticate(alice.tokens.access_token)).toThrow('expired or revoked');
    expect(store.get(`context:${alice.session.userId}`, 'voice')).toBeUndefined();
    expect(store.get(`context:${bob.session.userId}`, 'voice')).toBe('Bob private voice');
    expect(auth.authenticate(bob.tokens.access_token).userId).toBe(bob.session.userId);
    await login();
    expect(() => auth.authenticate(alice.tokens.access_token)).toThrow('expired or revoked');
  });
});

describe('LinkedIn credentials', () => {
  it('requires reconnection when an expired upstream token has no refresh grant', async () => {
    const flow = await login();
    const account = auth.getAccount(flow.session.userId);
    store.set('accounts', flow.session.userId, { ...account, expiresAt: Date.now() - 1 });
    const calls = provider.mock.calls.length;
    await expect(auth.getLinkedInToken(flow.session.userId)).rejects.toThrow('Reconnect your account');
    expect(provider.mock.calls).toHaveLength(calls);
  });

  it('refreshes only an issued upstream refresh token and coalesces concurrent requests', async () => {
    const flow = await login();
    const account: Account = { ...auth.getAccount(flow.session.userId), expiresAt: Date.now() - 1, refreshToken: 'issued-partner-refresh', refreshExpiresAt: Date.now() + 60_000 };
    store.set('accounts', flow.session.userId, account);
    const before = provider.mock.calls.length;
    const values = await Promise.all([auth.getLinkedInToken(flow.session.userId), auth.getLinkedInToken(flow.session.userId)]);
    expect(values).toEqual(['refreshed-provider-secret', 'refreshed-provider-secret']);
    expect(provider.mock.calls).toHaveLength(before + 1);
    const body = new URLSearchParams(String(provider.mock.calls.at(-1)![1]!.body));
    expect(body.get('refresh_token')).toBe('issued-partner-refresh');
  });

  it('uses only requested-and-granted provider scopes', async () => {
    provider.mockImplementationOnce(async () => new Response(JSON.stringify({ access_token: 'alice-provider-secret', expires_in: 3600, scope: 'openid profile r_member_social w_member_social' })));
    const flow = await login('alice', 'linkedin:read');
    const account = auth.getAccount(flow.session.userId);
    expect(account.scopes).toEqual(['openid', 'profile', 'r_member_social']);
    expect(account.scopes).not.toContain('w_member_social');
  });

  it('does not expose upstream error bodies, provider codes, or secrets in redirects', async () => {
    provider.mockImplementationOnce(async () => new Response(JSON.stringify({ access_token: 'leaked-secret', error: 'provider-debug-private' }), { status: 400 }));
    const flow = await upstream();
    const response = await flow.browser.get('/oauth/linkedin/callback').query({ state: flow.state, code: 'private-code' }).expect(302);
    expect(response.headers.location).not.toMatch(/leaked-secret|provider-debug-private|private-code/);
    expect(new URL(response.headers.location).searchParams.get('error')).toBe('access_denied');
  });
});
