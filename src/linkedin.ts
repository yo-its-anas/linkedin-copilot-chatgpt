import type { AuthService } from './auth.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';

const API_ORIGIN = 'https://api.linkedin.com';
const REQUEST_TIMEOUT_MS = 15_000;
const RESPONSE_BYTE_LIMIT = 1_048_576;
const POST_URN = /^urn:li:(share|ugcPost):[0-9]{1,30}$/;
const COMMENT_URN = /^urn:li:comment:\(urn:li:(activity|share|ugcPost):[0-9]{1,30},[0-9]{1,30}\)$/;
const ACTOR_URN = /^urn:li:(person|organization):[A-Za-z0-9_-]{1,128}$/;
const METRICS = ['IMPRESSION', 'MEMBERS_REACHED', 'REACTION', 'COMMENT', 'RESHARE'] as const;
type Metric = (typeof METRICS)[number];
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord : {};
}

function optionalText(value: unknown, limit = 20_000): string | undefined {
  return typeof value === 'string' ? value.slice(0, limit) : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function validatePostUrn(value: string): void {
  if (typeof value !== 'string' || !POST_URN.test(value)) {
    throw new AppError('invalid_input', 'Use an exact LinkedIn share or ugcPost URN returned by LinkedIn.');
  }
}

function validateCount(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new AppError('invalid_input', 'Count must be an integer between 1 and 100.');
  }
}

function validateText(value: string, limit: number): void {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new AppError('invalid_input', `Text must contain between 1 and ${limit} characters without control characters.`);
  }
}

/** This tool publishes literal text. Structured mentions/media are outside its contract. */
function littlePlaintext(text: string): string {
  return text.replace(/[\\|{}@\[\]()<>#*_~]/gu, '\\$&');
}

function decodeLittlePlaintext(text: string): string {
  // Only undo escaped plaintext characters; retain provider mention/hashtag markup as source text.
  return text.replace(/\\([\\|{}@\[\]()<>#*_~])/gu, '$1');
}

function outcomeUnknown(): AppError {
  return new AppError('write_outcome_unknown', 'The LinkedIn action may have completed, but its result could not be confirmed. Check LinkedIn before creating another action.', 502);
}

function invalidResponse(): AppError {
  return new AppError('linkedin_invalid_response', 'LinkedIn returned an unexpected response. Try again later.', 502);
}

export class LinkedInClient {
  constructor(
    private readonly config: Config,
    private readonly auth: AuthService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private requireScopes(userId: string, scopes: readonly string[]) {
    const account = this.auth.getAccount(userId);
    if (!account) {
      throw new AppError('connection_required', 'Connect your LinkedIn account to use this action.', 401);
    }
    if (scopes.some(scope => !this.config.linkedinScopes.includes(scope) || !account.scopes.includes(scope))) {
      throw new AppError('insufficient_scope', 'This LinkedIn capability is not available with the configured product access and your granted permissions.', 403);
    }
    return account;
  }

  private actor(userId: string): string {
    const memberId = this.auth.getAccount(userId)?.memberId;
    if (!memberId || !/^[A-Za-z0-9_-]{1,128}$/.test(memberId)) {
      throw new AppError('identity_unavailable', 'A verified LinkedIn Person ID is required for this action. The application must resolve it through an approved profile API.', 403);
    }
    return `urn:li:person:${memberId}`;
  }

  private async request(userId: string, path: string, scopes: readonly string[], options: {
    method?: 'GET' | 'POST' | 'DELETE'; body?: JsonRecord; restliMethod?: string;
  } = {}) {
    this.requireScopes(userId, scopes);
    const accessToken = await this.auth.getLinkedInToken(userId);
    // A refresh may have changed the account's grants.
    this.requireScopes(userId, scopes);
    const method = options.method ?? 'GET';
    const isWrite = method !== 'GET';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
      if (path.startsWith('/rest/')) {
        headers['LinkedIn-Version'] = this.config.linkedinApiVersion;
        headers['X-Restli-Protocol-Version'] = '2.0.0';
      }
      if (options.body) headers['Content-Type'] = 'application/json';
      if (options.restliMethod) headers['X-RestLi-Method'] = options.restliMethod;
      const response = await this.fetchImpl(`${API_ORIGIN}${path}`, {
        method, headers, signal: controller.signal, redirect: 'error',
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 401) throw new AppError('credentials_expired', 'LinkedIn credentials are expired or revoked. Reconnect your account.', 401);
        if (response.status === 403) throw new AppError('linkedin_access_denied', 'LinkedIn denied this action. Check the application product approval and account permissions.', 403);
        if (response.status === 404) throw new AppError('not_found', 'The LinkedIn item was not found or is not accessible to your account.', 404);
        if (response.status === 429) throw new AppError('linkedin_rate_limited', 'LinkedIn has temporarily limited requests. Wait before trying again.', 429);
        if (response.status >= 500 && isWrite) throw outcomeUnknown();
        throw new AppError('linkedin_request_failed', 'LinkedIn could not complete this request. Review the input and try again later.', response.status >= 500 ? 502 : 400);
      }
      if (response.status === 204) return { body: {}, headers: response.headers };
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > RESPONSE_BYTE_LIMIT) {
              await reader.cancel();
              throw isWrite ? outcomeUnknown() : invalidResponse();
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const responseText = Buffer.concat(chunks).toString('utf8');
      let body: JsonRecord;
      try {
        body = responseText ? record(JSON.parse(responseText)) : {};
      } catch {
        throw isWrite ? outcomeUnknown() : invalidResponse();
      }
      return { body, headers: response.headers };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isWrite) throw outcomeUnknown();
      if (controller.signal.aborted) throw new AppError('linkedin_timeout', 'LinkedIn did not respond in time. Try again later.', 504);
      throw new AppError('linkedin_unavailable', 'LinkedIn is temporarily unavailable. Try again later.', 502);
    } finally {
      clearTimeout(timer);
    }
  }

  async getMyProfile(userId: string) {
    const account = this.requireScopes(userId, ['openid', 'profile']);
    const { body } = await this.request(userId, '/v2/userinfo', ['openid', 'profile']);
    if (body.sub !== account.subject) throw invalidResponse();
    const picture = optionalText(body.picture, 4096);
    const profile: JsonRecord = {
      subject: account.subject,
      name: optionalText(body.name, 512),
      givenName: optionalText(body.given_name, 256),
      familyName: optionalText(body.family_name, 256),
      picture: picture?.startsWith('https://') ? picture : undefined,
      locale: optionalText(body.locale, 32),
    };
    if (account.scopes.includes('email') && this.config.linkedinScopes.includes('email')) {
      profile.email = optionalText(body.email, 320);
      profile.emailVerified = typeof body.email_verified === 'boolean' ? body.email_verified : undefined;
    }
    return profile;
  }

  private post(body: JsonRecord, author: string) {
    if (body.author !== author) {
      throw new AppError('not_authorized', 'Only the connected member\'s own posts can be read through this tool.', 403);
    }
    if (typeof body.id !== 'string' || !POST_URN.test(body.id)) throw invalidResponse();
    return {
      postUrn: body.id, author,
      text: decodeLittlePlaintext(optionalText(body.commentary) ?? ''),
      visibility: optionalText(body.visibility, 32),
      createdAt: number(body.createdAt), publishedAt: number(body.publishedAt),
      lastModifiedAt: number(body.lastModifiedAt),
    };
  }

  async getRecentPosts(userId: string, count: number) {
    validateCount(count);
    this.requireScopes(userId, ['r_member_social']);
    const author = this.actor(userId);
    const posts: ReturnType<LinkedInClient['post']>[] = [];
    const seen = new Set<string>();
    let start = 0;
    let hasMore = false;
    for (let page = 0; page < 5 && posts.length < count; page++) {
      const remaining = count - posts.length;
      const query = `q=author&author=${encodeURIComponent(author)}&count=${remaining}&start=${start}&sortBy=CREATED&viewContext=AUTHOR`;
      const { body } = await this.request(userId, `/rest/posts?${query}`, ['r_member_social'], { restliMethod: 'FINDER' });
      if (!Array.isArray(body.elements)) throw invalidResponse();
      for (const element of body.elements.slice(0, remaining)) {
        const post = this.post(record(element), author);
        if (!seen.has(post.postUrn)) { posts.push(post); seen.add(post.postUrn); }
      }
      const paging = record(body.paging);
      const links = Array.isArray(paging.links) ? paging.links.map(record) : [];
      const next = links.find(link => link.rel === 'next');
      hasMore = Boolean(next);
      if (!next || typeof next.href !== 'string') break;
      // Extract only an offset. Never follow an upstream URL with our bearer token.
      let nextStart: number;
      try {
        const nextUrl = new URL(next.href, API_ORIGIN);
        if (nextUrl.origin !== API_ORIGIN || nextUrl.pathname !== '/rest/posts') break;
        const offset = nextUrl.searchParams.get('start');
        if (offset === null || !/^\d{1,6}$/.test(offset)) break;
        nextStart = Number(offset);
      } catch { break; }
      if (!Number.isInteger(nextStart) || nextStart <= start) break;
      start = nextStart;
    }
    return { posts, requestedCount: count, returnedCount: posts.length, hasMore };
  }

  async getPost(userId: string, postUrn: string) {
    validatePostUrn(postUrn);
    this.requireScopes(userId, ['r_member_social']);
    const author = this.actor(userId);
    const { body } = await this.request(userId, `/rest/posts/${encodeURIComponent(postUrn)}?viewContext=AUTHOR`, ['r_member_social']);
    const post = this.post(body, author);
    if (post.postUrn !== postUrn) throw invalidResponse();
    return post;
  }

  private comment(value: unknown) {
    const body = record(value);
    const commentUrn = optionalText(body.commentUrn, 256);
    const id = typeof body.id === 'number' && Number.isSafeInteger(body.id) ? String(body.id) : optionalText(body.id, 30);
    const actor = optionalText(body.actor, 256);
    const parentComment = optionalText(body.parentComment, 256);
    return {
      commentUrn: commentUrn && COMMENT_URN.test(commentUrn) ? commentUrn : undefined,
      commentId: id && /^\d{1,30}$/.test(id) ? id : undefined,
      actor: actor && ACTOR_URN.test(actor) ? actor : undefined,
      text: optionalText(record(body.message).text) ?? '',
      parentCommentUrn: parentComment && COMMENT_URN.test(parentComment) ? parentComment : undefined,
      createdAt: number(record(body.created).time),
    };
  }

  async getComments(userId: string, postUrn: string, count: number) {
    validatePostUrn(postUrn);
    validateCount(count);
    const { body } = await this.request(userId, `/rest/socialActions/${encodeURIComponent(postUrn)}/comments?start=0&count=${count}`, ['r_member_social_feed']);
    if (!Array.isArray(body.elements)) throw invalidResponse();
    const comments = body.elements.slice(0, count).map(element => this.comment(element));
    const links = record(body.paging).links;
    return {
      postUrn, comments, requestedCount: count, returnedCount: comments.length,
      hasMore: Array.isArray(links) && links.some(link => record(link).rel === 'next'),
    };
  }

  async getPostMetrics(userId: string, postUrn: string) {
    validatePostUrn(postUrn);
    this.requireScopes(userId, ['r_member_postAnalytics']);
    // LinkedIn's entity finder authorizes against the authenticated member itself.
    // Requiring r_member_social here would wrongly block approved analytics-only apps.
    const type = postUrn.split(':')[2];
    const entity = `(${type}:${encodeURIComponent(postUrn)})`;
    const metrics = {} as Record<Metric, number | null>;
    for (const metric of METRICS) {
      const { body } = await this.request(userId, `/rest/memberCreatorPostAnalytics?q=entity&entity=${entity}&queryType=${metric}&aggregation=TOTAL`, ['r_member_postAnalytics'], { restliMethod: 'FINDER' });
      if (!Array.isArray(body.elements)) throw invalidResponse();
      if (body.elements.length === 0) { metrics[metric] = null; continue; }
      if (body.elements.length !== 1) throw invalidResponse();
      const point = record(body.elements[0]);
      const target = record(point.targetEntity);
      if (target[type!] !== postUrn || point.metricType !== metric) throw invalidResponse();
      const metricValue = number(point.count);
      if (metricValue === undefined) throw invalidResponse();
      metrics[metric] = metricValue;
    }
    return { postUrn, metrics, aggregation: 'TOTAL', source: 'LinkedIn Member Post Statistics API' };
  }

  async createPost(userId: string, text: string, visibility: 'PUBLIC' | 'CONNECTIONS') {
    validateText(text, 3000);
    if (visibility !== 'PUBLIC' && visibility !== 'CONNECTIONS') throw new AppError('invalid_input', 'Visibility must be PUBLIC or CONNECTIONS.');
    this.requireScopes(userId, ['w_member_social']);
    const author = this.actor(userId);
    const { headers } = await this.request(userId, '/rest/posts', ['w_member_social'], {
      method: 'POST', body: {
        author, commentary: littlePlaintext(text), visibility,
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
      },
    });
    const postUrn = headers.get('x-restli-id');
    if (!postUrn || !POST_URN.test(postUrn)) throw outcomeUnknown();
    return { postUrn, author, text, visibility, status: 'published' };
  }

  private async writeComment(userId: string, postUrn: string, text: string, parentCommentUrn?: string) {
    validatePostUrn(postUrn);
    validateText(text, 1250);
    if (parentCommentUrn !== undefined && !COMMENT_URN.test(parentCommentUrn)) throw new AppError('invalid_input', 'Use the exact parent comment URN returned by LinkedIn.');
    this.requireScopes(userId, ['w_member_social_feed']);
    const actor = this.actor(userId);
    const target = parentCommentUrn ?? postUrn;
    const { body, headers } = await this.request(userId, `/rest/socialActions/${encodeURIComponent(target)}/comments`, ['w_member_social_feed'], {
      method: 'POST', body: {
        actor, object: postUrn, message: { text }, ...(parentCommentUrn ? { parentComment: parentCommentUrn } : {}),
      },
    });
    const comment = this.comment(body);
    const headerId = headers.get('x-restli-id');
    const commentId = comment.commentId ?? (headerId && /^\d{1,30}$/.test(headerId) ? headerId : undefined);
    if (!comment.commentUrn && !commentId) throw outcomeUnknown();
    return { postUrn, commentUrn: comment.commentUrn, commentId, actor, text, parentCommentUrn, status: 'created' };
  }

  async createComment(userId: string, postUrn: string, text: string) {
    return this.writeComment(userId, postUrn, text);
  }

  async replyToComment(userId: string, postUrn: string, parentCommentUrn: string, text: string) {
    return this.writeComment(userId, postUrn, text, parentCommentUrn);
  }

  /** The MCP write service additionally verifies the per-user creation receipt before calling this. */
  async deletePost(userId: string, postUrn: string) {
    validatePostUrn(postUrn);
    this.requireScopes(userId, ['w_member_social']);
    this.actor(userId);
    await this.request(userId, `/rest/posts/${encodeURIComponent(postUrn)}`, ['w_member_social'], { method: 'DELETE', restliMethod: 'DELETE' });
    return { postUrn, status: 'deleted' };
  }
}
