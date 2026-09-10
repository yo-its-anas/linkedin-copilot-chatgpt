# Deployment and operations

## One durable server

Use Node 24.x and one process/replica. SQLite, write coordination, refresh locks
and member rate limits deliberately use a single-node topology. Deploying multiple
replicas against a shared file is unsupported. For scale-out, replace storage and
coordination with reviewed shared services before increasing replica count.

The Dockerfile builds TypeScript, removes development dependencies and runs as
`node`. Compose mounts `/data`, uses a read-only root filesystem, drops Linux
capabilities and binds port 3000 to host loopback. Set `NODE_ENV=production`, a
real HTTPS `PUBLIC_URL`, the exact broker and LinkedIn redirects, allowed origins,
approved provider scopes and secrets before `docker compose up --build -d`.
An HTTP PUBLIC_URL is intentionally rejected in production.

Terminate TLS at a reverse proxy preserving the public `Host`; do not rewrite it
to `localhost`. Forward requests to port 3000. The server rejects unknown hosts,
so health probes must send the configured public Host. Docker's healthcheck does
this automatically. `/health` is liveness; `/ready` checks readable storage.
Configure your platform's health path and expected Host consistently. Shutdown
stops accepting requests and allows up to ten seconds before exit.

## Railway / Render / similar Docker hosts

Create a Docker service from this repository. Attach a persistent volume at
`/data`, set `DATABASE_PATH=/data/linkedin.sqlite`, and restrict deployment to one
replica. Confirm the volume is writable by container UID 1000. Supply all values
from `.env.example` through the provider's secret settings, not the image or Git.
Use its public HTTPS domain as PUBLIC_URL and register that exact LinkedIn
callback. Disable concurrent/overlapping deployments that access the same SQLite
volume. Configure rollback around the same durable data and encryption key.

Do not deploy this store on ephemeral-only/serverless instances. A platform with
no durable single-instance volume needs an alternative transactional store first.
Host-specific provisioning and billing are operator tasks; no cloud resources
are created by this repository.

## Secrets, rate limiting and logs

Generate independent keys for storage and broker authentication. Restrict provider
client secrets and ENCRYPTION_KEY in the hosting secret manager. Keep the key
separate from backups. Fix a supported LinkedIn REST API version and revisit its
sunset before upgrades. Enabling a scope does not obtain product approval.

The process logs startup and minimal write audit events, never full HTTP queries
or bodies. Use platform health/error metrics for uptime. At the proxy, redact
Authorization, Cookie and all OAuth callback/token payloads. Do not enable verbose
SDK/provider debug logging with live credentials. Restrict audit access and apply
the documented retention period.

IP limiting is conservative when all traffic comes from one reverse proxy: the
app does not trust X-Forwarded-For. Put a validated-client-IP limiter at the edge.
There is also a per-member limit. Respect LinkedIn 429 responses; publishing calls
are never automatically retried. A durable ambiguous receipt means “inspect
LinkedIn,” not “generate another UUID.”

## Backup and recovery

For a simple consistent backup, stop the one process, copy the entire `/data`
volume including SQLite/WAL files, encrypt the backup and resume. Do not copy a
live database file alone. Keep the matching encryption key securely available and
restore-test on an isolated deployment with outbound writes disabled by scopes.
Never run restored and original deployments concurrently against real accounts.

Idempotency receipts are operational data: losing them can remove protection
against retrying an earlier action. After restore, reconcile potentially in-flight
writes against LinkedIn before allowing new IDs. Disconnect clears credentials,
preferences and ownership cache while minimal request receipts remain to prevent
duplicate operations across reconnects. For a full data-erasure request, the
operator must remove relevant encrypted records and retained backups according to
the published policy; do not promise deletion from immutable backups immediately.

Key rotation needs a reviewed offline migration or disconnect/reconnect with a
new store. No automatic rotation utility is claimed. Watch readiness, disk space,
token reconnection frequency, permission failures, 429s and unknown write outcomes.

## Release checks

Run `npm run check`, Python helper tests, `npm audit`, and `docker build` before
deployment. Run the real OAuth and host permission tests from
[CHATGPT_TESTING.md](CHATGPT_TESTING.md). Re-scan tool metadata after changing
enabled scope configuration and upload a new skill bundle after skill changes.
An archive build alone does not update an installed or published plugin.
