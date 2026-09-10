import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import type { AuthService, Session } from '../src/auth.js';
import type { LinkedInClient } from '../src/linkedin.js';
import { Store } from '../src/store.js';
import { AppError } from '../src/errors.js';
import { ToolService } from '../src/tools.js';

const providerScopes = ['openid', 'profile', 'r_member_social', 'r_member_social_feed', 'r_member_postAnalytics', 'w_member_social', 'w_member_social_feed'];
const config = { publicUrl: 'https://agent.example', linkedinScopes: providerScopes } as Config;
const session: Session = { userId: 'alice', scopes: ['linkedin:read', 'linkedin:write', 'context:write'] };
const post = 'urn:li:share:123';
let store: Store;
let auth: AuthService;
let client: LinkedInClient;
let service: ToolService;
let audit: ReturnType<typeof vi.fn>;
beforeEach(() => {
  store = new Store(':memory:', randomBytes(32));
  auth = { getAccount: vi.fn(() => ({ subject: 'alice-sub', memberId: 'alice-id', scopes: providerScopes, accessToken: 'secret-token', expiresAt: Date.now() + 3600000 })), disconnect: vi.fn() } as unknown as AuthService;
  client = { createPost: vi.fn(async () => ({ postUrn: post, status: 'published' })), deletePost: vi.fn(async () => ({ postUrn: post, status: 'deleted' })), getPost: vi.fn(async () => ({ postUrn: post })), getMyProfile: vi.fn(async () => ({ name: 'Alice' })) } as unknown as LinkedInClient;
  audit = vi.fn();
  service = new ToolService(config, store, auth, client, audit);
});
afterEach(() => { store.close(); });
const args = () => ({ text: 'Reviewed exact text', visibility: 'PUBLIC', request_id: randomUUID() });
const failure = (result: Awaited<ReturnType<ToolService['call']>>) => JSON.parse(result.content[0].text);

describe('tool discovery and host action permissions', () => {
  it('exposes complete OAuth and JSON schema metadata without model-created approval flags', () => {
    for (const tool of service.catalog()) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema.required).toEqual(['result']);
      expect(tool.securitySchemes).toEqual(tool._meta.securitySchemes);
      expect(tool.inputSchema.properties).not.toHaveProperty('approved');
    }
  });
  it.each(['linkedin_create_post', 'linkedin_create_comment', 'linkedin_reply_to_comment', 'linkedin_delete_post'])('marks %s as an external write', name => {
    const tool = service.catalog().find(t => t.name === name)!;
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    expect(tool.securitySchemes[0].scopes).toEqual(['linkedin:write']);
    if (name === 'linkedin_delete_post') expect(tool.annotations.destructiveHint).toBe(true);
  });
  it('marks context replacement and disconnect as destructive app writes', () => {
    for (const name of ['linkedin_update_user_context', 'linkedin_disconnect']) expect(service.catalog().find(t => t.name === name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
  it('omits unsupported capabilities and provider tools without configured grants', () => {
    const minimal = new ToolService({ ...config, linkedinScopes: ['openid', 'profile'] }, store, auth, client);
    expect(minimal.catalog()).toHaveLength(5);
    expect(minimal.catalog().some(t => /send_message|get_conversations|get_profile|search_posts|get_notifications|update_profile|create_post/.test(t.name))).toBe(false);
  });
  it('starts the linking flow with an authentication challenge rather than leaking data', async () => {
    const response = await service.call('linkedin_get_my_profile', {});
    expect(response.isError).toBe(true);
    expect(response._meta?.['mcp/www_authenticate'][0]).toContain('oauth-protected-resource');
    expect(client.getMyProfile).not.toHaveBeenCalled();
  });
  it('enforces app scopes even when LinkedIn granted write access', async () => {
    expect(failure(await service.call('linkedin_create_post', args(), { ...session, scopes: ['linkedin:read'] })).error).toBe('insufficient_scope');
    expect(client.createPost).not.toHaveBeenCalled();
  });
  it('enforces provider grants even when the app scope allows writes', async () => {
    vi.mocked(auth.getAccount).mockReturnValue({ subject: 'alice', accessToken: 'private', expiresAt: Date.now() + 3600000, scopes: ['openid', 'profile'] });
    expect(failure(await service.call('linkedin_create_post', args(), session)).error).toBe('permission_denied');
    expect(client.createPost).not.toHaveBeenCalled();
  });
  it.each([{ author: 'urn:li:person:bob' }, { approved: true }, { userId: 'bob' }, { text: '' }, { request_id: 'not-a-uuid' }])('rejects invalid or privilege-bearing input %j', async extra => {
    expect(failure(await service.call('linkedin_create_post', { ...args(), ...extra }, session)).error).toBe('invalid_input');
    expect(client.createPost).not.toHaveBeenCalled();
  });
});

describe('isolated context and writes', () => {
  it('reports reconnection when both upstream credentials have expired', async () => {
    vi.mocked(auth.getAccount).mockReturnValue({ subject: 'alice', scopes: providerScopes, accessToken: 'private', expiresAt: Date.now() - 1, refreshToken: 'private-refresh', refreshExpiresAt: Date.now() - 1 });
    const result = await service.call('linkedin_get_connection_status', {}, session);
    expect(result.structuredContent?.result.reconnectRequired).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-refresh');
  });
  it('keeps stored voice sections private to the authenticated identity', async () => {
    await service.call('linkedin_update_user_context', { section: 'voice', content: 'Alice private style' }, session);
    const bob = await service.call('linkedin_get_user_context', {}, { ...session, userId: 'bob' });
    expect(JSON.stringify(bob)).not.toContain('Alice private style');
    const alice = await service.call('linkedin_get_user_context', {}, session);
    expect(JSON.stringify(alice)).toContain('Alice private style');
    expect(JSON.stringify(alice)).not.toContain('secret-token');
  });
  it('replays an identical completed action without publishing twice', async () => {
    const input = args();
    const first = await service.call('linkedin_create_post', input, session);
    const replay = await service.call('linkedin_create_post', input, session);
    expect(first).toEqual(replay);
    expect(client.createPost).toHaveBeenCalledTimes(1);
    expect(store.get(`owned-posts:${session.userId}`, post)).toBeDefined();
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/Reviewed exact text|secret-token/);
  });
  it('rejects changed text using the same request ID', async () => {
    const input = args();
    await service.call('linkedin_create_post', input, session);
    expect(failure(await service.call('linkedin_create_post', { ...input, text: 'Different' }, session)).error).toBe('request_conflict');
    expect(client.createPost).toHaveBeenCalledTimes(1);
  });
  it('blocks simultaneous attempts before the first response arrives', async () => {
    let finish!: (value: any) => void;
    vi.mocked(client.createPost).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const input = args();
    const first = service.call('linkedin_create_post', input, session);
    expect(failure(await service.call('linkedin_create_post', input, session)).error).toBe('outcome_unconfirmed');
    finish({ postUrn: post });
    await first;
    expect(client.createPost).toHaveBeenCalledTimes(1);
  });
  it('retains uncertainty after a timeout and never automatically retries it', async () => {
    vi.mocked(client.createPost).mockRejectedValue(new AppError('write_outcome_unknown', 'Check LinkedIn before trying again.', 502));
    const input = args();
    await service.call('linkedin_create_post', input, session);
    expect(failure(await service.call('linkedin_create_post', input, session)).error).toBe('outcome_unconfirmed');
    expect(client.createPost).toHaveBeenCalledTimes(1);
  });
  it('does not accept another user\'s creation receipt as deletion authority', async () => {
    store.set('owned-posts:bob', post, { createdAt: Date.now() });
    vi.mocked(auth.getAccount).mockReturnValue({ subject: 'alice', memberId: 'alice-id', scopes: ['openid', 'profile', 'w_member_social'], accessToken: 'secret', expiresAt: Date.now() + 3600000 });
    expect(failure(await service.call('linkedin_delete_post', { post_urn: post, request_id: randomUUID() }, session)).error).toBe('ownership_unverified');
    expect(client.deletePost).not.toHaveBeenCalled();
  });
  it('verifies ownership through an authorized read when no receipt exists', async () => {
    vi.mocked(client.getPost).mockRejectedValue(new AppError('not_authorized', 'Not your post.', 403));
    await service.call('linkedin_delete_post', { post_urn: post, request_id: randomUUID() }, session);
    expect(client.getPost).toHaveBeenCalledWith('alice', post);
    expect(client.deletePost).not.toHaveBeenCalled();
  });
  it('deletes an app-created post once and records the receipt', async () => {
    store.set('owned-posts:alice', post, { createdAt: Date.now() });
    const result = await service.call('linkedin_delete_post', { post_urn: post, request_id: randomUUID() }, session);
    expect(result.isError).not.toBe(true);
    expect(client.deletePost).toHaveBeenCalledWith('alice', post);
    expect(store.get('owned-posts:alice', post)).toBeUndefined();
  });
  it('sanitizes unexpected failures', async () => {
    vi.mocked(client.getMyProfile).mockRejectedValue(new Error('secret-token private stack trace'));
    const result = await service.call('linkedin_get_my_profile', {}, session);
    expect(failure(result).error).toBe('internal_error');
    expect(JSON.stringify(result)).not.toMatch(/secret-token|private stack/);
  });
});
