# Install LinkedIn Copilot for ChatGPT

The experience is: **install the skills once, describe your task, connect the Copilot app when a supported action needs it**. Your drafts, revisions and follow-up requests can stay in one conversation.

## Start today on desktop

In a local ChatGPT Work conversation with the built-in plugin creator, paste:

```text
@plugin-creator Add https://github.com/yo-its-anas/linkedin-copilot-chatgpt.git
as a plugin marketplace and help me install LinkedIn Copilot for ChatGPT.
Use the existing package and keep LinkedIn connection optional.
```

This is a request to the host's installer, not a magic command embedded in this repository. The installer needs access to the repository and the relevant local capabilities. Follow the host's installation UI, reload if prompted, and start a new chat after installing.

CLI alternative:

```sh
codex plugin marketplace add yo-its-anas/linkedin-copilot-chatgpt --ref main
```

Open the desktop Plugins browser and install **LinkedIn Copilot for ChatGPT** from **LinkedIn Copilot by Muhammad Anas**. This repository supplies `.agents/plugins/marketplace.json`; its Git source points to the native plugin at the repository root. [Marketplace setup](https://developers.openai.com/plugins/build/plugins).

No Node server or LinkedIn credentials are needed to use the installed writing skills. Node and developer credentials are for operators who host the optional connection.

## Workspace installation

Where workspace import is available, an admin imports the repository URL under **Admin > Plugins > Add > Import marketplace**, leaves Path empty, selects `main`, and makes the plugin available to the intended roles. Members then install it. The workspace controls installation and authentication policy independently of repository defaults. [Workspace management](https://learn.chatgpt.com/docs/enterprise/plugin-management).

A public directory listing is a separate publication step. Until it exists, an ordinary chat may not be able to offer this project as an install button. A similarly named LinkedIn connector is a separate product.

## What to say after installation

```text
What can LinkedIn Copilot help me with?
Write a post using these notes from my DevOps project.
Make the draft more direct and keep my technical details.
Turn it into a carousel, then plan three related posts for next week.
```

ChatGPT selects the relevant installed skills. Each follow-up can use the same chat's draft and context. Profile audits and inbox triage use material you supply when no supported API data is available.

## Add the optional Copilot connection

The operator must first deploy this repository's MCP server with HTTPS, configure LinkedIn OAuth and product grants, and register the server as an app in the target ChatGPT workspace. Follow [Deployment](DEPLOYMENT.md) and [live acceptance tests](CHATGPT_TESTING.md). This repository does not include a hosted endpoint or someone else's credentials.

Build a bundle referencing that app:

```sh
npm run package:plugin -- --app-id asdk_app_YOUR_ID
```

Supply a real `asdk_app_`, `connector_`, or `templated_apps_` ID. A listing ID beginning `plugin_asdk_app_` is normalized automatically. The generated `.app.json` marks the connection optional, so drafts still work before login. Upload the generated plugin through the available private/workspace flow; for GitHub-managed distribution, the operator must commit that real mapping and matching manifest references to the distributed source. Do not substitute another LinkedIn app's ID.

Registered-app packages contain no bundled server declarations. GitHub-imported packages with bundled MCP servers are desktop-only under the documented workspace rules, even with HTTPS URLs. Use the registered-app path for a connected workspace package. [App references and desktop restrictions](https://learn.chatgpt.com/docs/enterprise/plugin-management).

Users complete OAuth and the host's approval flow. Then requests such as "read my basic profile" or "publish this exact draft publicly" use the tools actually enabled for that account. LinkedIn's official API access, identity and scope requirements still apply.

## Using only the MCP app in a chat

A registered Copilot server also provides:

- `linkedin_get_copilot_guide`: product identity, twelve workflows and configured tools.
- `linkedin_get_workflow`: a selected workflow's canonical instructions and reference data.

These public tools can guide a conversation even when filesystem skills are unavailable. They return instructions for ChatGPT to apply; they do not install persistent skills, generate drafts themselves or modify memory. Account reads, saved preferences and external writes use separate protected tools. No provider tokens appear in public help results.

## Package modes for maintainers

| Command | Result |
| --- | --- |
| `npm run package:plugin` | Twelve skills; no server dependency |
| `npm run package:plugin -- --skills-only` | Explicit skills-only package |
| `npm run package:plugin -- --app-id asdk_app_YOUR_ID` | Skills plus optional registered app |
| `npm run package:plugin -- --url http://localhost:3000/mcp` | Local desktop MCP development package |

Production packaging additionally checks the actual HTTPS endpoint and publisher policy URLs. It never registers, deploys or publishes a service automatically.

## Installed, connected and remembered are different states

The host manages installed skills and their availability in new chats. The Copilot app stores only reviewed writing preferences saved through its authenticated context tool. It does not install into ChatGPT memory, run continuously in the background or silently authorize LinkedIn actions. Ordinary drafting uses the context available in the current conversation.
