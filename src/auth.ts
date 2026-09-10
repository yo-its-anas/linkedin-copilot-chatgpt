import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import { AppError } from './errors.js';
import type { Config } from './config.js';
import { Store } from './store.js';

export interface Session { userId: string; scopes: string[] }
export interface Account {
  subject: string;
  memberId?: string;
  scopes: string[];
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
}

interface Authorization {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  resource: string;
  scopes: string[];
  binding: string;
  csrf: string;
  providerScopes: string[];
}
interface Grant extends Session { clientId: string; resource: string; generation: number; familyId: string }
interface Code extends Omit<Grant, 'familyId'> { redirectUri: string; challenge: string }
interface Refresh extends Grant { expiresAt: number }
interface Family { userId: string; clientId: string; revoked: boolean; expiresAt: number }

const BROKER_SCOPES = ['linkedin:read', 'linkedin:write', 'context:write'];
const AUTH_TTL = 10 * 60_000;
const CODE_TTL = 2 * 60_000;
const ACCESS_TTL = 15 * 60_000;
const REFRESH_TTL = 30 * 24 * 60 * 60_000;
const COOKIE = 'linkedin_oauth_binding';
const LINKEDIN_AUTHORIZE = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';
const randomToken = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (left: string, right: string) => timingSafeEqual(Buffer.from(digest(left), 'hex'), Buffer.from(digest(right), 'hex'));
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

function parameter(source: unknown, key: string, required = true, max = 2048): string {
  const value = source && typeof source === 'object' ? (source as Record<string, unknown>)[key] : undefined;
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value) || value.length > max) throw new AppError('invalid_request', `Invalid ${key} parameter.`);
  return value;
}

function scopesFrom(value: string): string[] {
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
  if (!scopes.length || scopes.some(scope => !BROKER_SCOPES.includes(scope))) throw new AppError('invalid_scope', 'An unsupported or empty permission scope was requested.');
  return scopes;
}

function route(handler: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache').set('Referrer-Policy', 'no-referrer');
    try { await handler(req, res); }
    catch (error) {
      const safe = error instanceof AppError ? error : new AppError('server_error', 'The authorization service could not complete the request.', 500);
      res.status(safe.status).json({ error: safe.code, error_description: safe.message });
    }
  };
}

/** OAuth broker: downstream MCP credentials and upstream LinkedIn tokens never mix. */
export class AuthService {
  private readonly refreshing = new Map<string, Promise<string>>();
  private readonly resource: string;

  constructor(private readonly config: Config, private readonly store: Store, private readonly fetchImpl: typeof fetch = fetch) {
    this.resource = `${config.publicUrl}/mcp`;
  }

  mount(app: Express): void {
    const form = express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20 });
    const metadata = {
      issuer: this.config.publicUrl,
      authorization_endpoint: `${this.config.publicUrl}/authorize`,
      token_endpoint: `${this.config.publicUrl}/token`,
      revocation_endpoint: `${this.config.publicUrl}/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      revocation_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: BROKER_SCOPES,
    };
    app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json(metadata));
    const resourceMetadata = {
      resource: this.resource,
      authorization_servers: [this.config.publicUrl],
      scopes_supported: BROKER_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'LinkedIn Copilot for ChatGPT',
    };
    app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], (_req, res) => res.json(resourceMetadata));
    app.get('/authorize', route((req, res) => this.authorize(req, res)));
    app.post('/authorize', form, route((req, res) => this.consent(req, res)));
    app.get('/oauth/linkedin/callback', route((req, res) => this.callback(req, res)));
    app.post('/token', form, route((req, res) => this.token(req, res)));
    app.post('/revoke', form, route((req, res) => this.revoke(req, res)));
  }

  private cookieOptions() {
    return { httpOnly: true, secure: this.config.publicUrl.startsWith('https:'), sameSite: 'lax' as const, path: '/', maxAge: AUTH_TTL };
  }

  private browserBinding(req: Request): string {
    const entries = (req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${COOKIE}=`));
    if (entries.length !== 1) return '';
    const value = entries[0]!.slice(COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
  }

  private providerScopes(scopes: string[]): string[] {
    return this.config.linkedinScopes.filter(scope => {
      if (scope === 'openid' || scope === 'profile') return true;
      if (scope === 'r_liteprofile' || scope === 'r_basicprofile') return scopes.includes('linkedin:read') || scopes.includes('linkedin:write');
      if (scope.startsWith('r_')) return scopes.includes('linkedin:read');
      if (scope.startsWith('w_')) return scopes.includes('linkedin:write');
      return false;
    });
  }

  private authorize(req: Request, res: Response): void {
    const clientId = parameter(req.query, 'client_id');
    const redirectUri = parameter(req.query, 'redirect_uri');
    // Never redirect errors until the downstream client and exact destination are validated.
    if (clientId !== this.config.mcpClientId) throw new AppError('unauthorized_client', 'The client is not registered.');
    if (!this.config.redirectUris.includes(redirectUri)) throw new AppError('invalid_request', 'The redirect URI is not registered.');
    if (parameter(req.query, 'response_type') !== 'code') throw new AppError('unsupported_response_type', 'Only authorization code flow is supported.');
    const resource = parameter(req.query, 'resource');
    if (resource !== this.resource) throw new AppError('invalid_target', 'The requested resource is not this MCP server.');
    const challenge = parameter(req.query, 'code_challenge');
    if (parameter(req.query, 'code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      throw new AppError('invalid_request', 'A valid S256 PKCE challenge is required.');
    }
    const scopes = scopesFrom(parameter(req.query, 'scope'));
    const binding = this.browserBinding(req) || randomToken();
    const authorization: Authorization = {
      clientId, redirectUri, resource, challenge, scopes,
      state: parameter(req.query, 'state'), binding: digest(binding), csrf: randomToken(),
      providerScopes: this.providerScopes(scopes),
    };
    const requestId = randomToken();
    this.store.set('consent', requestId, authorization, Date.now() + AUTH_TTL);
    res.cookie(COOKIE, binding, this.cookieOptions());
    const descriptions: Record<string, string> = {
      'linkedin:read': 'Read your own available LinkedIn profile, posts, and analytics.',
      'linkedin:write': 'Publish posts and perform supported comment or deletion actions that you request.',
      'context:write': 'Save and update your writing voice, audience, positioning, and goals.',
    };
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect LinkedIn Copilot for ChatGPT</title><main><h1>Connect LinkedIn Copilot for ChatGPT</h1><p>Allow the configured ChatGPT client to use the following permissions for your LinkedIn account?</p><ul>${scopes.map(scope => `<li>${escapeHtml(descriptions[scope]!)}</li>`).join('')}</ul><p>LinkedIn will separately ask you to authorize available LinkedIn permissions. You can disconnect later. Each external action remains subject to ChatGPT's permission settings.</p><p>Client: <strong>${escapeHtml(clientId)}</strong><br>Return to: <strong>${escapeHtml(new URL(redirectUri).origin)}</strong></p><form method="post" action="/authorize"><input type="hidden" name="request_id" value="${requestId}"><input type="hidden" name="csrf" value="${authorization.csrf}"><button name="decision" value="allow" type="submit">Allow and continue to LinkedIn</button> <button name="decision" value="deny" type="submit">Cancel</button></form></main></html>`);
  }

  private consent(req: Request, res: Response): void {
    const requestId = parameter(req.body, 'request_id');
    const authorization = this.store.get<Authorization>('consent', requestId);
    if (!authorization || !equal(authorization.binding, digest(this.browserBinding(req))) || !equal(authorization.csrf, parameter(req.body, 'csrf'))) {
      throw new AppError('invalid_request', 'The authorization request expired or its browser binding is invalid.');
    }
    const origin = req.get('Origin');
    if (origin && origin !== this.config.publicUrl) throw new AppError('invalid_request', 'The consent origin is invalid.');
    const decision = parameter(req.body, 'decision');
    if (!['allow', 'deny'].includes(decision)) throw new AppError('invalid_request', 'Invalid consent decision.');
    this.store.take('consent', requestId);
    if (decision === 'deny') {
      this.redirectResult(res, authorization, { error: 'access_denied', error_description: 'The user declined access.' });
      return;
    }
    const state = randomToken();
    this.store.set('linkedin-state', state, authorization, Date.now() + AUTH_TTL);
    const url = new URL(LINKEDIN_AUTHORIZE);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: this.config.linkedinClientId,
      redirect_uri: `${this.config.publicUrl}/oauth/linkedin/callback`,
      state, scope: authorization.providerScopes.join(' '),
    }).toString();
    res.redirect(302, url.toString());
  }

  private redirectResult(res: Response, authorization: Authorization, values: Record<string, string>): void {
    const url = new URL(authorization.redirectUri);
    for (const [key, value] of Object.entries({ ...values, state: authorization.state })) url.searchParams.set(key, value);
    res.redirect(302, url.toString());
  }

  private async providerJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: globalThis.Response;
    try { response = await this.fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { throw new AppError('temporarily_unavailable', 'LinkedIn could not be reached. Please try connecting again.', 502); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 400) throw new AppError('linkedin_reauthorization_required', 'LinkedIn authorization was rejected. Reconnect your account.', 401);
      throw new AppError('linkedin_unavailable', 'LinkedIn could not complete the authorization request.', 502);
    }
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('missing response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65_536) { await reader.cancel(); throw new Error('oversized response'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      const text = Buffer.concat(chunks).toString('utf8');
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid response');
      return data as Record<string, unknown>;
    } catch { throw new AppError('linkedin_invalid_response', 'LinkedIn returned an invalid authorization response.', 502); }
  }

  private tokenAccount(data: Record<string, unknown>, requestedScopes: string[], previous?: Account): Omit<Account, 'subject'> {
    const expires = Number(data.expires_in);
    if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16_384 || !Number.isSafeInteger(expires) || expires <= 0 || expires > 366 * 24 * 60 * 60) {
      throw new AppError('linkedin_invalid_response', 'LinkedIn returned invalid token details.', 502);
    }
    // OAuth permits omitted scope when it matches the requested scope (RFC 6749 §5.1).
    const reported = typeof data.scope === 'string' ? data.scope.split(/[\s,]+/) : requestedScopes;
    const scopes = requestedScopes.filter(scope => reported.includes(scope));
    const account: Omit<Account, 'subject'> = { accessToken: data.access_token, expiresAt: Date.now() + expires * 1000, scopes };
    if (previous?.memberId) account.memberId = previous.memberId;
    const refreshToken = typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : previous?.refreshToken;
    if (refreshToken) {
      account.refreshToken = refreshToken;
      if (data.refresh_token_expires_in !== undefined) {
        const refreshSeconds = Number(data.refresh_token_expires_in);
        if (!Number.isSafeInteger(refreshSeconds) || refreshSeconds < 0 || refreshSeconds > 10 * 366 * 24 * 60 * 60) throw new AppError('linkedin_invalid_response', 'LinkedIn returned an invalid refresh token lifetime.', 502);
        account.refreshExpiresAt = Date.now() + refreshSeconds * 1000;
      } else if (previous?.refreshExpiresAt !== undefined) account.refreshExpiresAt = previous.refreshExpiresAt;
    }
    return account;
  }

  private async callback(req: Request, res: Response): Promise<void> {
    const state = parameter(req.query, 'state');
    const authorization = this.store.get<Authorization>('linkedin-state', state);
    if (!authorization || !equal(authorization.binding, digest(this.browserBinding(req)))) throw new AppError('invalid_request', 'The LinkedIn state expired or its browser binding is invalid.');
    this.store.take('linkedin-state', state);
    if (parameter(req.query, 'error', false)) {
      this.redirectResult(res, authorization, { error: 'access_denied', error_description: 'LinkedIn authorization was not completed.' });
      return;
    }
    const code = parameter(req.query, 'code', true, 4096);
    try {
      const data = await this.providerJson(LINKEDIN_TOKEN, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${this.config.publicUrl}/oauth/linkedin/callback`, client_id: this.config.linkedinClientId, client_secret: this.config.linkedinClientSecret }),
      });
      const token = this.tokenAccount(data, authorization.providerScopes);
      if (!token.scopes.includes('openid')) throw new AppError('invalid_scope', 'LinkedIn identity permission was not granted.');
      const profile = await this.providerJson('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${token.accessToken}` } });
      if (typeof profile.sub !== 'string' || !profile.sub || profile.sub.length > 512) throw new AppError('linkedin_invalid_response', 'LinkedIn did not return a valid account identity.', 502);
      // OIDC subject is not assumed to be a Person API ID. Resolve only with approved profile API permission.
      if (token.scopes.some(scope => scope === 'r_liteprofile' || scope === 'r_basicprofile')) {
        const member = await this.providerJson('https://api.linkedin.com/v2/me?projection=(id)', { headers: { Authorization: `Bearer ${token.accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' } });
        if (typeof member.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(member.id)) token.memberId = member.id;
      }
      const userId = digest(`linkedin:${this.config.linkedinClientId}:${profile.sub}`);
      this.store.set('accounts', userId, { ...token, subject: profile.sub } satisfies Account);
      const authorizationCode = randomToken();
      this.store.set('codes', authorizationCode, {
        userId, scopes: authorization.scopes, clientId: authorization.clientId,
        redirectUri: authorization.redirectUri, challenge: authorization.challenge,
        resource: authorization.resource, generation: this.generation(userId),
      } satisfies Code, Date.now() + CODE_TTL);
      this.redirectResult(res, authorization, { code: authorizationCode });
    } catch (error) {
      const temporary = error instanceof AppError && error.status >= 500;
      this.redirectResult(res, authorization, { error: temporary ? 'temporarily_unavailable' : 'access_denied', error_description: temporary ? 'LinkedIn could not complete connection. Please try again.' : 'LinkedIn authorization was not completed. Please reconnect.' });
    }
  }

  private authenticateClient(req: Request): string {
    let clientId: string;
    let secret: string;
    const authorization = req.get('Authorization');
    if (authorization) {
      if (!/^Basic [A-Za-z0-9+/]+=*$/.test(authorization) || parameter(req.body, 'client_secret', false)) throw new AppError('invalid_client', 'Client authentication failed.', 401);
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator < 0) throw new AppError('invalid_client', 'Client authentication failed.', 401);
      try { clientId = decodeURIComponent(decoded.slice(0, separator).replace(/\+/g, ' ')); secret = decodeURIComponent(decoded.slice(separator + 1).replace(/\+/g, ' ')); }
      catch { throw new AppError('invalid_client', 'Client authentication failed.', 401); }
      const bodyClientId = parameter(req.body, 'client_id', false);
      if (bodyClientId && bodyClientId !== clientId) throw new AppError('invalid_client', 'Client authentication failed.', 401);
    } else {
      clientId = parameter(req.body, 'client_id');
      secret = parameter(req.body, 'client_secret');
    }
    if (!equal(clientId, this.config.mcpClientId) || !equal(secret, this.config.mcpClientSecret)) throw new AppError('invalid_client', 'Client authentication failed.', 401);
    return clientId;
  }

  private generation(userId: string): number { return this.store.get<number>('generation', userId) ?? 0; }

  private validGrant(grant: Grant | Code | undefined): grant is Grant | Code {
    return !!grant && grant.resource === this.resource && grant.generation === this.generation(grant.userId) && !!this.store.get<Account>('accounts', grant.userId);
  }

  private token(req: Request, res: Response): void {
    const clientId = this.authenticateClient(req);
    if (parameter(req.body, 'resource') !== this.resource) throw new AppError('invalid_target', 'The requested resource is not this MCP server.');
    const grantType = parameter(req.body, 'grant_type');
    let grant: Grant;
    let refreshExpiresAt: number;
    if (grantType === 'authorization_code') {
      const rawCode = parameter(req.body, 'code');
      const code = this.store.take<Code>('codes', rawCode);
      const verifier = parameter(req.body, 'code_verifier');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!this.validGrant(code) || code.clientId !== clientId || code.redirectUri !== parameter(req.body, 'redirect_uri') || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !equal(code.challenge, challenge)) {
        throw new AppError('invalid_grant', 'The authorization code or PKCE verification is invalid or expired.');
      }
      const familyId = randomToken();
      refreshExpiresAt = Date.now() + REFRESH_TTL;
      this.store.set('families', familyId, { userId: code.userId, clientId, revoked: false, expiresAt: refreshExpiresAt } satisfies Family, refreshExpiresAt);
      grant = { userId: code.userId, scopes: code.scopes, clientId, resource: this.resource, generation: code.generation, familyId };
    } else if (grantType === 'refresh_token') {
      const rawRefresh = parameter(req.body, 'refresh_token');
      const refresh = this.store.get<Refresh>('refresh', rawRefresh);
      if (!refresh) {
        const spent = this.store.get<Refresh>('spent-refresh', rawRefresh);
        if (spent?.clientId === clientId) this.revokeFamily(spent.familyId);
        throw new AppError('invalid_grant', 'The refresh token is invalid, expired, or already used.');
      }
      const family = this.store.get<Family>('families', refresh.familyId);
      if (!this.validGrant(refresh) || refresh.clientId !== clientId || !family || family.revoked) throw new AppError('invalid_grant', 'The refresh token has been revoked or expired.');
      const scope = parameter(req.body, 'scope', false);
      const scopes = scope ? scopesFrom(scope) : refresh.scopes;
      if (scopes.some(value => !refresh.scopes.includes(value))) throw new AppError('invalid_scope', 'Refresh cannot expand the granted permissions.');
      this.store.take('refresh', rawRefresh);
      this.store.set('spent-refresh', rawRefresh, refresh, refresh.expiresAt);
      grant = { ...refresh, scopes };
      refreshExpiresAt = refresh.expiresAt;
    } else throw new AppError('unsupported_grant_type', 'Only authorization_code and refresh_token grants are supported.');
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const expiresAt = Math.min(Date.now() + ACCESS_TTL, refreshExpiresAt);
    this.store.set('access', accessToken, grant, expiresAt);
    this.store.set('refresh', refreshToken, { ...grant, expiresAt: refreshExpiresAt } satisfies Refresh, refreshExpiresAt);
    res.json({ access_token: accessToken, token_type: 'Bearer', expires_in: Math.floor((expiresAt - Date.now()) / 1000), refresh_token: refreshToken, scope: grant.scopes.join(' ') });
  }

  private revokeFamily(familyId: string): void {
    const family = this.store.get<Family>('families', familyId);
    if (family) this.store.set('families', familyId, { ...family, revoked: true }, family.expiresAt);
  }

  private revoke(req: Request, res: Response): void {
    const clientId = this.authenticateClient(req);
    const token = parameter(req.body, 'token');
    const grant = this.store.get<Grant>('access', token) ?? this.store.get<Refresh>('refresh', token) ?? this.store.get<Refresh>('spent-refresh', token);
    if (grant?.clientId === clientId) this.revokeFamily(grant.familyId);
    // RFC 7009: do not disclose whether the submitted token existed.
    res.status(200).end();
  }

  authenticate(bearer: string): Session {
    if (!/^[A-Za-z0-9_-]{43}$/.test(bearer)) throw new AppError('invalid_token', 'A valid MCP access token is required.', 401);
    const grant = this.store.get<Grant>('access', bearer);
    if (!this.validGrant(grant)) throw new AppError('invalid_token', 'The MCP access token is expired or revoked.', 401);
    const family = this.store.get<Family>('families', grant.familyId);
    if (!family || family.revoked || grant.clientId !== this.config.mcpClientId) throw new AppError('invalid_token', 'The MCP access token is expired or revoked.', 401);
    return { userId: grant.userId, scopes: [...grant.scopes] };
  }

  getAccount(userId: string): Account {
    const account = this.store.get<Account>('accounts', userId);
    if (!account) throw new AppError('linkedin_not_connected', 'Connect your LinkedIn account to continue.', 401);
    return account;
  }

  async getLinkedInToken(userId: string): Promise<string> {
    const account = this.getAccount(userId);
    if (account.expiresAt > Date.now() + 30_000) return account.accessToken;
    if (!account.refreshToken || (account.refreshExpiresAt !== undefined && account.refreshExpiresAt <= Date.now())) throw new AppError('linkedin_reauthorization_required', 'LinkedIn access expired. Reconnect your account.', 401);
    const inFlight = this.refreshing.get(userId);
    if (inFlight) return inFlight;
    const generation = this.generation(userId);
    const refresh = (async () => {
      const data = await this.providerJson(LINKEDIN_TOKEN, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: account.refreshToken!, client_id: this.config.linkedinClientId, client_secret: this.config.linkedinClientSecret }),
      });
      const current = this.store.get<Account>('accounts', userId);
      if (!current || this.generation(userId) !== generation || current.accessToken !== account.accessToken) throw new AppError('linkedin_reauthorization_required', 'The connection changed while refreshing. Reconnect if necessary.', 401);
      const updated = { ...this.tokenAccount(data, account.scopes, account), subject: account.subject } satisfies Account;
      this.store.set('accounts', userId, updated);
      return updated.accessToken;
    })();
    this.refreshing.set(userId, refresh);
    try { return await refresh; } finally { if (this.refreshing.get(userId) === refresh) this.refreshing.delete(userId); }
  }

  disconnect(userId: string): void {
    this.store.set('generation', userId, this.generation(userId) + 1);
    this.store.delete('accounts', userId);
    this.store.deleteNamespace(`context:${userId}`);
    this.store.deleteNamespace(`owned-posts:${userId}`);
  }
}
