import { resolve } from 'node:path';

export interface Config {
  publicUrl: string;
  port: number;
  databasePath: string;
  encryptionKey: string;
  mcpClientId: string;
  mcpClientSecret: string;
  redirectUris: string[];
  linkedinClientId: string;
  linkedinClientSecret: string;
  linkedinScopes: string[];
  linkedinApiVersion: string;
  allowedOrigins: string[];
  nodeEnv: string;
}

const supportedLinkedInScopes = new Set([
  'openid', 'profile', 'r_liteprofile', 'r_basicprofile', 'w_member_social',
  'r_member_social', 'r_member_social_feed', 'w_member_social_feed', 'r_member_postAnalytics',
]);

/** Configuration fails closed; secrets are never printed in validation errors. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  const nodeEnv = env.NODE_ENV ?? 'development';
  const checkedUrl = (value: string, name: string): URL => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute URL.`); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.hash || value.includes('*') ||
        (url.protocol !== 'https:' && !(nodeEnv !== 'production' && loopback && url.protocol === 'http:'))) {
      throw new Error(`${name} must use HTTPS (loopback HTTP is allowed in development), without credentials, fragments, or wildcards.`);
    }
    return url;
  };
  const publicValue = required('PUBLIC_URL');
  const publicParsed = checkedUrl(publicValue, 'PUBLIC_URL');
  if (publicParsed.pathname !== '/' || publicParsed.search) throw new Error('PUBLIC_URL must be an origin without a path or query.');
  const publicUrl = publicParsed.origin;
  const encryptionKey = required('ENCRYPTION_KEY');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey) || Buffer.from(encryptionKey, 'base64').length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte random key.');
  }
  const mcpClientSecret = required('MCP_CLIENT_SECRET');
  if (mcpClientSecret.length < 32) throw new Error('MCP_CLIENT_SECRET must contain at least 32 characters.');
  const redirectUris = [...new Set(required('MCP_REDIRECT_URIS').split(',').map(value => value.trim()))];
  for (const uri of redirectUris) checkedUrl(uri, 'MCP_REDIRECT_URIS');
  const allowedOrigins = [...new Set((env.ALLOWED_ORIGINS ?? publicUrl).split(',').map(value => value.trim()))];
  for (const origin of allowedOrigins) {
    if (checkedUrl(origin, 'ALLOWED_ORIGINS').origin !== origin) throw new Error('ALLOWED_ORIGINS entries must be exact origins.');
  }
  const linkedinScopes = [...new Set(`openid profile ${env.LINKEDIN_SCOPES ?? ''}`.split(/[\s,]+/).filter(Boolean))];
  if (linkedinScopes.some(scope => !supportedLinkedInScopes.has(scope))) throw new Error('LINKEDIN_SCOPES contains an unsupported scope.');
  const linkedinApiVersion = required('LINKEDIN_API_VERSION');
  if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(linkedinApiVersion)) throw new Error('LINKEDIN_API_VERSION must be a supported YYYYMM version.');
  const port = Number(env.PORT ?? '3000');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  return {
    publicUrl, nodeEnv, port, encryptionKey, mcpClientSecret, redirectUris, allowedOrigins,
    mcpClientId: required('MCP_CLIENT_ID'),
    linkedinClientId: required('LINKEDIN_CLIENT_ID'),
    linkedinClientSecret: required('LINKEDIN_CLIENT_SECRET'),
    linkedinScopes, linkedinApiVersion,
    databasePath: resolve(env.DATABASE_PATH ?? 'data/linkedin.sqlite'),
  };
}
