# LinkedIn Copilot for ChatGPT

**Your AI-powered LinkedIn content, engagement and growth agent — built natively for ChatGPT.**

Built and maintained by **Muhammad Anas**

[LinkedIn Profile](https://www.linkedin.com/in/muhammad-anas-a35b1a334/) · [GitHub Repository](https://github.com/yo-its-anas/linkedin-copilot-chatgpt) · [Available Skills](#available-skills) · [Installation](#installation)

Twelve skills. Natural conversation. OAuth-connected tools. Your voice, with control over every external action.

## Overview

LinkedIn Copilot transforms ChatGPT into a connected LinkedIn assistant for content, engagement and growth workflows. It helps you analyze your presence, improve your writing, plan what to publish and use supported LinkedIn actions through an OAuth-connected MCP server.

Drafting and analysis work with material you supply. Live account access depends on the official APIs and permissions available to your LinkedIn developer application. This repository contains the implementation and deployment structure; it is not an already hosted service or an approved Plugin Directory listing.

## Why I Built This

I built this ChatGPT-native redesign to bring LinkedIn writing, planning and engagement into one conversational workflow. I wanted to move from an idea to a useful draft, review the result and take a supported action without losing the context behind it.

My interests in DevOps, cloud infrastructure and software engineering shape how I approach AI-powered engineering workflows and agentic systems. Useful agents need more than prompts: they need clear permissions, reliable integrations, testable behavior and a practical path to deployment. LinkedIn Copilot is my application of those principles to a focused, everyday workflow.

— **Muhammad Anas**

## Features

- **Analyze your LinkedIn presence:** assess supplied profile content and identify focused improvements.
- **Audit posts and performance:** use supplied posts and metrics, or authorized API data when available.
- **Generate high-quality posts:** develop hooks and complete drafts grounded in your experience and voice.
- **Create weekly content strategies:** organize themes, angles, posting plans and engagement priorities.
- **Humanize AI-generated writing:** improve clarity, specificity and rhythm with optional editorial helpers.
- **Create carousel content:** outline slides and copy; rendered artifacts depend on available rendering tools.
- **Repurpose long-form content:** turn articles, notes and transcripts into distinct LinkedIn ideas.
- **Draft comments and replies:** contribute relevant observations and respond in context.
- **Manage engagement workflows:** prioritize responses and prepare follow-up drafts.
- **Analyze inbox conversations:** triage conversations you paste or supply; live inbox access is not implemented.
- **Perform supported actions:** publish text posts, comment, reply or delete your own posts when API access and all authorization requirements are satisfied.

Saved preferences are separate from skill instructions. The packaged `user-profile/` files are blank templates, and the humanizer's style heuristics are not an AI-authorship detector.

## Architecture

```mermaid
flowchart TD
    A[ChatGPT] --> B[LinkedIn Copilot Skills]
    B --> C[Intent Router]
    C --> D[MCP Tool Layer]
    D --> E[User Approval]
    E --> F[LinkedIn API]
```

ChatGPT interprets the request and applies the appropriate skills. The intent router coordinates workflows; the MCP server handles OAuth, tool schemas, permissions and official API calls. The approval step represents ChatGPT's host-controlled review for external actions. Drafting and reading have their own appropriate permission requirements.

The server uses TypeScript, Node.js 24, the official MCP SDK and Express. OAuth credentials and user context are stored in encrypted SQLite. Provider tokens stay on the server and are never returned to the model. Write receipts help prevent duplicate actions. The server does not require an OpenAI API key.

See [the detailed architecture](ARCHITECTURE.md) and [migration guide](MIGRATION.md).

## Available Skills

| Skill | Purpose |
| --- | --- |
| `linkedin-post` | Generate hooks and a complete post draft |
| `linkedin-plan` | Build a weekly content and engagement plan |
| `linkedin-audit` | Analyze content and available performance evidence |
| `linkedin-profile` | Apply a 100-point profile rubric to supplied content |
| `linkedin-humanize` | Edit for natural, specific writing |
| `linkedin-carousel` | Develop a slide sequence and carousel copy |
| `linkedin-repurpose` | Extract reusable angles from long-form material |
| `linkedin-comment` | Draft specific, useful comments |
| `linkedin-reply` | Triage comments and prepare replies |
| `linkedin-dm` | Draft outbound messages for manual sending |
| `linkedin-inbox` | Analyze and triage supplied conversations |
| `linkedin-router` | Coordinate natural-language, multi-skill requests |

## Example Conversations

> “Write a LinkedIn post about what I learned deploying a Kubernetes application. Ask me for the details you need.”

> “Here are my last 20 posts and their metrics. Audit what worked and plan next week.”

> “Rewrite this draft in my voice. Keep the technical details and remove generic claims.”

> “Turn this article into a seven-slide LinkedIn carousel.”

> “Here are three inbox conversations. Prioritize them and draft thoughtful replies.”

> “Publish this exact final draft with public visibility.”

The final request uses an external write tool only if the connected account has the required capabilities and ChatGPT's approval requirements are satisfied. Asking to write a draft does not authorize publishing.

## LinkedIn Integration

The MCP server connects through OAuth to official LinkedIn APIs. Start with **Sign In with LinkedIn using OpenID Connect** and `openid profile` for basic connected identity. Additional features require their own products, scopes and, where applicable, LinkedIn approval.

1. Create a LinkedIn developer app and store its credentials server-side.
2. Register `https://YOUR-HOST/oauth/linkedin/callback` as the LinkedIn callback.
3. Configure a separate OAuth client for ChatGPT, using the exact callback displayed by its app setup.
4. Enable only LinkedIn scopes your developer application actually holds.
5. Reconnect after changing requested permissions and test each enabled capability.

**Publishing has an additional identity requirement.** This implementation resolves a verified Person ID through `/v2/me` with an existing `r_liteprofile` or approved `r_basicprofile` grant. It does not assume an OIDC subject is a Person ID. A new self-service OIDC + Share app may therefore be unable to publish with this implementation, even with `w_member_social`.

Full historical reads, analytics and comments require separate grants. There is no live personal inbox, DM sending, profile editing, arbitrary profile search, media upload or scheduled publishing implementation. Those skills use supplied material and prepare drafts for manual use.

## User Approval & Safety

External LinkedIn actions execute only when all four conditions hold:

1. **LinkedIn officially exposes the required API.**
2. **The user has authenticated.**
3. **The required permissions and scopes are available.**
4. **ChatGPT's approval requirements are satisfied.**

Skills present the exact content, target and visibility for review. ChatGPT controls approval prompts; tool annotations are not proof of approval. The server independently enforces account identity, scopes, input validation and ownership checks. It does not accept a model-generated `approved: true` flag as authorization.

OAuth uses state, CSRF protection and PKCE on the ChatGPT-to-server flow. Credentials are encrypted at rest, and repeated action IDs return stored receipts. Uncertain write outcomes block automatic retries pending reconciliation.

Disconnecting deletes local credentials and preferences and invalidates broker access. Removing provider authorization is a separate action in LinkedIn's Permitted Services. Read [Security](SECURITY.md) and [Permissions](docs/PERMISSIONS.md).

## Installation

Clone the repository with Node.js **24.x** and npm installed:

```sh
git clone https://github.com/yo-its-anas/linkedin-copilot-chatgpt.git
cd linkedin-copilot-chatgpt
npm ci --ignore-scripts
```

Build a local skill/plugin bundle:

```sh
npm run package:plugin
```

The command creates `release/development-*/linkedin-copilot-chatgpt.zip` and a matching plugin folder. The bundle excludes credentials, databases, dependencies and caches.

For ChatGPT, register your reachable HTTPS `/mcp` endpoint using the available custom app/developer flow. Configure OAuth, connect the account and scan its tools. Then package the skills with the connection's real technical app ID:

```sh
npm run package:plugin -- --url https://YOUR-HOST/mcp --app-id plugin_asdk_app_YOUR_ID
```

Install the generated bundle through the local/private plugin flow available in your workspace. Registering MCP tools alone does not install the twelve skills. The source `.app.json` is intentionally empty until a real app ID is provided. Workspace access and installation surfaces vary; follow [ChatGPT testing](docs/CHATGPT_TESTING.md) and [submission preparation](docs/SUBMISSION.md).

## Local Development

Copy the example environment file. In PowerShell:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Run the random-value command twice: use independent values for `ENCRYPTION_KEY` and `MCP_CLIENT_SECRET`. Fill in your LinkedIn credentials and the exact ChatGPT OAuth callback. The LinkedIn client secret and MCP client secret are separate credentials.

```sh
npm run dev
```

`GET /health` checks the process, `/ready` checks storage and `POST /mcp` serves stateless Streamable HTTP. OAuth discovery is exposed at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`. Anonymous discovery is supported; private tool calls require account linking. GET and DELETE `/mcp` return 405.

ChatGPT needs a reachable HTTPS endpoint. When using a tunnel or reverse proxy, update `PUBLIC_URL`, `ALLOWED_ORIGINS` and the LinkedIn callback to the public origin. Preserve the public Host header.

## Deployment

Set production environment values and provide HTTPS through a reverse proxy, then run:

```sh
docker compose up --build -d
```

The container runs as a non-root user and persists encrypted SQLite on a named volume. The host port binds to loopback. Use **one process and one replica**; horizontal scaling requires shared transactional storage and distributed coordination.

Production candidate packaging requires the real endpoint, registered app ID, publisher and public policy URLs:

```sh
npm run package:plugin -- --production --url https://YOUR-HOST/mcp --app-id plugin_asdk_app_YOUR_ID --publisher "Muhammad Anas" --website https://YOUR-HOST --privacy https://YOUR-HOST/privacy --terms https://YOUR-HOST/terms
```

Replace these illustrative values with your deployed service details. Packaging creates a review candidate; it does not deploy, submit or publish the app. Live OAuth, LinkedIn grants and ChatGPT approval behavior must be validated before release. See [deployment operations](docs/DEPLOYMENT.md).

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` locally; `production` when deployed |
| `PORT` | HTTP port; example uses `3000` |
| `PUBLIC_URL` | Externally reachable server origin |
| `DATABASE_PATH` | Persistent SQLite path |
| `ENCRYPTION_KEY` | Base64-encoded random 32-byte encryption key |
| `MCP_CLIENT_ID` | Preconfigured ChatGPT OAuth client identifier |
| `MCP_CLIENT_SECRET` | Independent random broker client secret, at least 32 characters |
| `MCP_REDIRECT_URIS` | Comma-separated exact allowed ChatGPT OAuth callbacks |
| `LINKEDIN_CLIENT_ID` | LinkedIn developer app client ID |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn developer app client secret |
| `LINKEDIN_SCOPES` | Granted provider scopes; baseline `openid profile` |
| `LINKEDIN_API_VERSION` | Configured REST API version; example uses `202608` |
| `ALLOWED_ORIGINS` | Comma-separated allowed request origins |

Use [.env.example](.env.example) as the reference. Never commit `.env`, tokens or encryption keys. Configuration cannot grant permissions that LinkedIn has not approved.

## Testing

```sh
npm run check
python -m unittest discover -s tests -p "test_*.py"
```

The checks compile TypeScript, run automated tests and validate plugin packaging. Tests cover OAuth, scopes, encrypted storage, tenant isolation, write receipts, ownership, MCP transport and routing. Python tests cover optional writing helpers. LinkedIn responses are mocked; these tests do not publish posts or establish live API approval.

For account-specific OAuth and host approval checks, follow the [live testing guide](docs/CHATGPT_TESTING.md). The deterministic routing helper is a regression aid; actual ChatGPT skill selection also needs testing in the host.

## API Compatibility Matrix

| Capability | Required access | Implementation |
| --- | --- | --- |
| Basic connected profile | `openid profile` | Supported |
| Own post history and text | `r_member_social`, closed to new grants | Conditional |
| Read comments | `r_member_social_feed` | Conditional |
| Own post metrics | `r_member_postAnalytics` | Conditional |
| Publish/delete own text posts | `w_member_social` and verified Person ID | Conditional; deletion verifies ownership |
| Comment and reply | `w_member_social_feed` and verified Person ID | Conditional |
| Saved writing preferences | Authenticated app context permissions | Supported |
| Full profile audit | User-supplied profile content | Analysis and suggested edits |
| Personal inbox and DMs | User-supplied conversations | Triage and drafts; no live read/send |
| Media upload, reactions, scheduling | No implemented adapter | Unavailable |

Broker scopes (`linkedin:read`, `linkedin:write`, `context:write`) apply in addition to provider grants. See the [full API compatibility matrix](docs/LINKEDIN_API_MATRIX.md) for endpoint details, official sources, version assumptions and product restrictions.

## Roadmap

- Validate OAuth and approved capabilities against a designated live LinkedIn app.
- Expand real ChatGPT skill-selection and approval evaluations.
- Improve carousel artifact generation with available rendering tools.
- Add shared storage and distributed coordination before supporting multiple replicas.
- Evaluate additional official API capabilities only where access and permissions permit.
- Prepare public deployment, support resources and directory submission evidence.

These are planned improvements, not currently available services or promised API access.

## Contributing

Issues and pull requests are welcome in [the repository](https://github.com/yo-its-anas/linkedin-copilot-chatgpt). Describe the problem, expected behavior and relevant API access without including account credentials or private messages.

Keep changes focused, preserve attribution and run the checks above. Integration changes should reference official LinkedIn documentation and include meaningful permission and failure-path tests. Document any new environment settings or deployment requirements.

## License

Licensed under the [MIT License](LICENSE). Portions derived from the upstream project retain:

> Copyright (c) 2026 Jake Schincariol

The ChatGPT-native redesign and additional work are documented as:

> Modifications and additional work Copyright (c) 2026 Muhammad Anas

Both notices and the MIT permission notice must remain with applicable copies and substantial portions.

## Author

### Muhammad Anas

**DevOps Engineer | Cloud & AI Automation | Agentic Systems**

Creator and maintainer of the ChatGPT-native redesign.

LinkedIn:  
[https://www.linkedin.com/in/muhammad-anas-a35b1a334/](https://www.linkedin.com/in/muhammad-anas-a35b1a334/)

GitHub:  
[yo-its-anas](https://github.com/yo-its-anas) · [linkedin-copilot-chatgpt](https://github.com/yo-its-anas/linkedin-copilot-chatgpt)

If you find the project useful, consider starring the repository.

## Credits

LinkedIn Copilot for ChatGPT is a substantial ChatGPT-native redesign and extension of the open-source [`linkedin-agent-skill`](https://github.com/Jakeschincariol/linkedin-agent-skill) project originally created by **[Jake Schincariol](https://github.com/Jakeschincariol)**.

The redesigned project introduces ChatGPT-native skill orchestration, MCP architecture, OAuth-based LinkedIn connectivity, permission-aware actions, expanded documentation, testing and production deployment structure.

The upstream hook catalog, profile rubric, writing frameworks and humanizer methods form part of this project's foundation. Jake Schincariol's original copyright notice is retained under the MIT License.
