import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../src/auth.js';
import type { Config } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { LinkedInClient } from '../src/linkedin.js';

const SCOPES = ['openid', 'profile', 'w_member_social', 'r_member_social', 'w_member_social_feed', 'r_member_social_feed', 'r_member_postAnalytics'];
const POST = 'urn:li:share:123456';
const AUTHOR = 'urn:li:person:verified_member';
const PARENT = 'urn:li:comment:(urn:li:activity:111111,222222)';
const TOKEN = 'provider-secret-never-in-tool-results';

function fixture(options: { scopes?: string[]; configured?: string[]; memberId?: string | null } = {}) {
  const scopes = options.scopes ?? SCOPES;
  const account = {
    subject: 'oidc_subject_is_different',
    memberId: options.memberId === null ? undefined : options.memberId ?? 'verified_member',
    scopes: [...scopes], accessToken: TOKEN, expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getAccount: vi.fn(() => account),
    getLinkedInToken: vi.fn(async () => TOKEN),
  };
  const fetchImpl = vi.fn<typeof fetch>();
  const config = { linkedinScopes: options.configured ?? SCOPES, linkedinApiVersion: '202608' } as Config;
  return { client: new LinkedInClient(config, auth as unknown as AuthService, fetchImpl), fetchImpl, auth, account };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function ownPost(extra: Record<string, unknown> = {}) {
  return { id: POST, author: AUTHOR, commentary: 'My post', visibility: 'PUBLIC', createdAt: 1000, ...extra };
}

afterEach(() => vi.useRealTimers());

describe('LinkedIn identity and read authorization', () => {
  it('only returns documented OIDC claims and omits email unless separately granted', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json({ sub: 'oidc_subject_is_different', name: 'Member', email: 'private@example.test', access_token: TOKEN, internal: { password: TOKEN }, picture: 'https://media.licdn.com/photo.jpg' }));
    const profile = await client.getMyProfile('alice');
    expect(profile.name).toBe('Member');
    expect(profile).not.toHaveProperty('email');
    expect(JSON.stringify(profile)).not.toContain(TOKEN);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.linkedin.com/v2/userinfo');
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
    expect(fetchImpl.mock.calls[0]![1]!.headers).not.toHaveProperty('LinkedIn-Version');
  });

  it('returns email only when both configuration and the member grant include email', async () => {
    const { client, fetchImpl } = fixture({ configured: [...SCOPES, 'email'], scopes: [...SCOPES, 'email'] });
    fetchImpl.mockResolvedValue(json({ sub: 'oidc_subject_is_different', email: 'member@example.test', email_verified: false }));
    expect(await client.getMyProfile('alice')).toMatchObject({ email: 'member@example.test', emailVerified: false });
  });

  it('rejects a mismatched userinfo subject', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json({ sub: 'another-user', name: 'Other Member' }));
    await expect(client.getMyProfile('alice')).rejects.toMatchObject({ code: 'linkedin_invalid_response' });
  });

  it('requires profile and openid before calling userinfo', async () => {
    const { client, fetchImpl } = fixture({ scopes: ['profile'] });
    await expect(client.getMyProfile('alice')).rejects.toMatchObject({ code: 'insufficient_scope' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('will not derive a Person ID from OIDC sub', async () => {
    const { client, fetchImpl } = fixture({ memberId: null });
    await expect(client.createPost('alice', 'Hello', 'PUBLIC')).rejects.toMatchObject({ code: 'identity_unavailable' });
    await expect(client.getRecentPosts('alice', 20)).rejects.toMatchObject({ code: 'identity_unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks configured access as well as member consent', async () => {
    const { client, fetchImpl } = fixture({ configured: ['openid', 'profile'] });
    await expect(client.getPost('alice', POST)).rejects.toMatchObject({ code: 'insufficient_scope' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rechecks granted scopes after token refresh', async () => {
    const { client, fetchImpl, auth, account } = fixture();
    auth.getLinkedInToken.mockImplementation(async () => { account.scopes = ['openid', 'profile']; return TOKEN; });
    await expect(client.getPost('alice', POST)).rejects.toMatchObject({ code: 'insufficient_scope' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes the authenticated user to account and token resolution', async () => {
    const { client, fetchImpl, auth } = fixture();
    fetchImpl.mockResolvedValue(json(ownPost()));
    await client.getPost('alice', POST);
    expect(auth.getAccount).toHaveBeenCalledWith('alice');
    expect(auth.getLinkedInToken).toHaveBeenCalledWith('alice');
    expect(fetchImpl.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'LinkedIn-Version': '202608', 'X-Restli-Protocol-Version': '2.0.0' });
  });

  it('blocks reading another member post even when the provider returns it', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json(ownPost({ author: 'urn:li:person:someone_else' })));
    await expect(client.getPost('alice', POST)).rejects.toMatchObject({ code: 'not_authorized' });
  });

  it('uses the returned ID to ensure the requested post is being read', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json(ownPost({ id: 'urn:li:share:99999' })));
    await expect(client.getPost('alice', POST)).rejects.toMatchObject({ code: 'linkedin_invalid_response' });
  });

  it('shapes post results and decodes only escaped little plaintext', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json(ownPost({ commentary: 'Use \\(a\\) \\* b', privateToken: TOKEN })));
    const result = await client.getPost('alice', POST);
    expect(result).toMatchObject({ postUrn: POST, text: 'Use (a) * b', author: AUTHOR });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('pages by validated offset and retains the authenticated author filter', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValueOnce(json({ elements: [ownPost()], paging: { links: [{ rel: 'next', href: 'https://api.linkedin.com/rest/posts?start=2&author=attacker' }] } }));
    fetchImpl.mockResolvedValueOnce(json({ elements: [ownPost({ id: 'urn:li:ugcPost:55555' })], paging: { links: [] } }));
    const result = await client.getRecentPosts('alice', 2);
    expect(result.returnedCount).toBe(2);
    const request = new URL(String(fetchImpl.mock.calls[1]![0]));
    expect(request.searchParams.get('author')).toBe(AUTHOR);
    expect(request.searchParams.get('start')).toBe('2');
    expect(request.searchParams.get('sortBy')).toBe('CREATED');
  });

  it('never follows an upstream pagination URL to another origin', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json({ elements: [ownPost()], paging: { links: [{ rel: 'next', href: 'https://attacker.example/steal?start=2' }] } }));
    const result = await client.getRecentPosts('alice', 20);
    expect(result).toMatchObject({ returnedCount: 1, hasMore: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('requires the current social feed scope for comments', async () => {
    const { client, fetchImpl } = fixture({ scopes: ['openid', 'profile', 'r_member_social'] });
    await expect(client.getComments('alice', POST, 20)).rejects.toMatchObject({ code: 'insufficient_scope' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns only bounded comment fields', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json({ elements: [{ id: '222222', commentUrn: PARENT, actor: AUTHOR, message: { text: 'Question?' }, created: { time: 500 }, access_token: TOKEN }], paging: { links: [] } }));
    const result = await client.getComments('alice', POST, 1);
    expect(result.comments).toEqual([expect.objectContaining({ commentId: '222222', commentUrn: PARENT, text: 'Question?' })]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe('LinkedIn member metrics', () => {
  it.each(['urn:li:share:123456', 'urn:li:ugcPost:123456'])('encodes the entity union for %s without requiring post read access', async postUrn => {
    const { client, fetchImpl } = fixture({ configured: ['r_member_postAnalytics'], scopes: ['r_member_postAnalytics'], memberId: null });
    fetchImpl.mockImplementation(async input => {
      const request = new URL(String(input));
      const type = postUrn.split(':')[2]!;
      expect(request.searchParams.get('entity')).toBe(`(${type}:${postUrn})`);
      expect(request.searchParams.get('aggregation')).toBe('TOTAL');
      return json({ elements: [{ count: 7, metricType: request.searchParams.get('queryType'), targetEntity: { [type]: postUrn } }] });
    });
    const result = await client.getPostMetrics('alice', postUrn);
    expect(result.metrics).toEqual({ IMPRESSION: 7, MEMBERS_REACHED: 7, REACTION: 7, COMMENT: 7, RESHARE: 7 });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('keeps missing metrics null and preserves a real zero', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValueOnce(json({ elements: [{ count: 0, metricType: 'IMPRESSION', targetEntity: { share: POST } }] }));
    fetchImpl.mockImplementation(async () => json({ elements: [] }));
    const result = await client.getPostMetrics('alice', POST);
    expect(result.metrics).toMatchObject({ IMPRESSION: 0, REACTION: null, MEMBERS_REACHED: null });
  });

  it('rejects metrics for a different entity', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json({ elements: [{ count: 5, metricType: 'IMPRESSION', targetEntity: { share: 'urn:li:share:999' } }] }));
    await expect(client.getPostMetrics('alice', POST)).rejects.toMatchObject({ code: 'linkedin_invalid_response' });
  });
});

describe('LinkedIn writes', () => {
  it('publishes exact plaintext through a server-selected verified actor', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(new Response(null, { status: 201, headers: { 'x-restli-id': POST } }));
    const text = 'Build (a) * b @member #DevOps';
    expect(await client.createPost('alice', text, 'CONNECTIONS')).toMatchObject({ postUrn: POST, author: AUTHOR, text, visibility: 'CONNECTIONS' });
    const payload = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(payload).toMatchObject({ author: AUTHOR, commentary: 'Build \\(a\\) \\* b \\@member \\#DevOps', lifecycleState: 'PUBLISHED', visibility: 'CONNECTIONS' });
    expect(payload.distribution).toEqual({ feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] });
    expect(payload.author).not.toContain('oidc_subject');
  });

  it('does not treat a missing successful creation ID as a safe failure', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json({}, 201));
    await expect(client.createPost('alice', 'Hello', 'PUBLIC')).rejects.toMatchObject({ code: 'write_outcome_unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('requires feed-write permission, not just the generic posting scope', async () => {
    const { client, fetchImpl } = fixture({ scopes: ['openid', 'profile', 'w_member_social'] });
    await expect(client.createComment('alice', POST, 'Hi')).rejects.toMatchObject({ code: 'insufficient_scope' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates comments with the documented object and message shape', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json({ id: '222222', commentUrn: PARENT }, 201));
    const result = await client.createComment('alice', POST, 'Useful example.');
    expect(result).toMatchObject({ commentId: '222222', commentUrn: PARENT, actor: AUTHOR, text: 'Useful example.' });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({ actor: AUTHOR, object: POST, message: { text: 'Useful example.' } });
  });

  it('replies with the exact composite parent URN, without converting activity and share IDs', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(new Response(null, { status: 201, headers: { 'x-restli-id': '333333' } }));
    const result = await client.replyToComment('alice', POST, PARENT, 'Thanks for asking.');
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(PARENT)}/comments`);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toMatchObject({ object: POST, parentComment: PARENT, actor: AUTHOR });
    expect(result).toMatchObject({ commentId: '333333', parentCommentUrn: PARENT });
    expect(result.commentUrn).toBeUndefined();
  });

  it('uses DELETE on the encoded post URN without replaying the call', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await client.deletePost('alice', POST)).toEqual({ postUrn: POST, status: 'deleted' });
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry an uncertain write or expose network details', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockRejectedValue(new Error(`connection failed ${TOKEN}`));
    const error = await client.createPost('alice', 'Hello', 'PUBLIC').catch(value => value);
    expect(error).toMatchObject({ code: 'write_outcome_unknown' });
    expect(String(error)).not.toContain(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('LinkedIn validation and provider errors', () => {
  it.each(['https://www.linkedin.com/posts/id', 'urn:li:share:123?token=secret', 'urn:li:activity:123', '//attacker.example/path'])('rejects unsupported input URN %s before network access', async urn => {
    const { client, fetchImpl } = fixture();
    await expect(client.getPost('alice', urn)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([0, 101, -1, 1.5, Number.NaN])('rejects invalid count %s', async count => {
    const { client, fetchImpl } = fixture();
    await expect(client.getRecentPosts('alice', count)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(3001), 'unsafe\u0000text'])('rejects invalid post text before a write', async text => {
    const { client, fetchImpl } = fixture();
    await expect(client.createPost('alice', text, 'PUBLIC')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([[401, 'credentials_expired'], [403, 'linkedin_access_denied'], [404, 'not_found'], [429, 'linkedin_rate_limited'], [500, 'linkedin_request_failed']])('maps %s without provider body leaks', async (status, code) => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(json({ access_token: TOKEN, message: `raw provider error ${TOKEN}` }, Number(status)));
    const error = await client.getPost('alice', POST).catch(value => value);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(String(error)).not.toContain(TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds provider response size', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(new Response('x'.repeat(1_048_577)));
    await expect(client.getPost('alice', POST)).rejects.toMatchObject({ code: 'linkedin_invalid_response' });
  });

  it('sanitizes invalid provider JSON', async () => {
    const { client, fetchImpl } = fixture();
    fetchImpl.mockResolvedValue(new Response(`not-json ${TOKEN}`));
    const error = await client.getPost('alice', POST).catch(value => value);
    expect(error.code).toBe('linkedin_invalid_response');
    expect(String(error)).not.toContain(TOKEN);
  });

  it('aborts a slow request after a finite timeout', async () => {
    vi.useFakeTimers();
    const { client, fetchImpl } = fixture();
    fetchImpl.mockImplementation(async (_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = client.getPost('alice', POST).catch(value => value);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toMatchObject({ code: 'linkedin_timeout' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
