# Security and data handling

## Authentication boundaries

ChatGPT authenticates to the MCP broker; LinkedIn is a separate upstream provider.
Opaque broker tokens go to the host's connection machinery. LinkedIn credentials
stay server-side and never appear in tool results, including hidden metadata.
Tokens cannot be forwarded directly between the two OAuth systems.

The broker uses a preconfigured confidential client, client-secret Basic/POST,
authorization codes, mandatory S256 PKCE, exact redirects, exact resource binding,
one-use codes, and browser-bound consent/CSRF. It does not advertise unsupported
DCR/CIMD. Upstream LinkedIn uses the documented confidential code exchange and
independent one-use state. Consider an established identity provider before a
large public rollout; this limited broker still needs independent security review.

| Record | Lifetime |
| --- | --- |
| Consent/LinkedIn state | 10 minutes |
| Authorization code | 2 minutes, one use |
| Broker access token | Up to 15 minutes |
| Rotating broker refresh family | Absolute 30 days |
| LinkedIn tokens | Provider-reported expiry |
| Minimal write audit | 90 days |

Refresh replay revokes the token family. Every request checks resource, client,
account generation, expiry and family status. LinkedIn refresh requires an actual
issued refresh token; otherwise reconnect. Disconnect invalidates existing broker
grants and deletes local provider credentials/preferences. LinkedIn-side removal
is a separate user action in Permitted Services. In-flight external requests may
already have reached LinkedIn when disconnect occurs; check their outcomes.

## Storage and retention

SQLite records use AES-256-GCM with random per-record nonces and authenticated
namespace/key binding. Index keys are HMAC-derived. WAL and full synchronous
durability protect receipts across restarts. A wrong encryption key fails startup.
Keep `ENCRYPTION_KEY`, both OAuth secrets and credentials in a secret manager;
restrict the volume and backups. Store the encryption key separately from backups.

Preferences persist until overwritten, cleared or disconnected. Ownership caches
are cleared on disconnect. Minimal idempotency receipts (identifiers, payload hash
and outcome, without draft text) survive disconnect to prevent duplicate writes
after reconnect; operators must account for them in deletion/retention procedures.
Audit expires after 90 days.
Expired broker records are cleaned periodically. Logs must exclude request bodies,
tokens, OAuth codes, cookies, headers, drafts and private messages. Configure proxy
logs accordingly: ordinary access logs may capture callback query strings. Apply
at most 90-day log retention and describe actual retention in the privacy policy.

No automatic key-rotation utility is supplied. Stop the service, back up the
volume, migrate all records with a reviewed decrypt/re-encrypt operation and
replace the key atomically; alternatively disconnect accounts and replace the
store under the retention policy. Merely changing the key makes data unreadable.

## Network and action controls

Production requires HTTPS, exact Host/Origin validation, security headers,
bounded request bodies and rate limits. Forwarded IP headers are not trusted.
The 120 requests/minute IP limit aggregates proxy traffic; configure a trusted
edge limiter before raising it. A 60 requests/minute member limit also applies.
These protections do not state LinkedIn's quota.

Provider calls use hardcoded official origins, prohibit redirects, enforce
timeouts and response bounds, and sanitize errors. Pagination reconstructs safe
queries; user URLs cannot become authenticated fetch targets. Unsupported APIs
have no tools. Writes enforce scopes and ownership independently of host approval.
Durable request markers block same-ID retries after uncertain outcomes. See
[permissions](docs/PERMISSIONS.md).

Deploy one process/replica with durable storage. Scaling requires a shared
transactional store, distributed limiter and coordination. Protect and restore-test
backups, patch dependencies, and complete automated plus live acceptance tests.
Mocked tests are not a penetration test, provider approval or proof of the host UI.
Publish a private security reporting contact before release; never put live
credentials or private member content in public issues.
