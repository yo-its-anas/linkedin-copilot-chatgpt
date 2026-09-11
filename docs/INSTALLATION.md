# Install LinkedIn Copilot for ChatGPT

The experience is: **install the skills once, describe your task, connect the Copilot app when a supported action needs it**. Your drafts, revisions and follow-up requests can stay in one conversation.

## Start on ChatGPT web

Use [Web setup](WEB_SETUP.md). A Create form that accepts skills and a Create form
that asks for an MCP URL are different routes. The former can use a skill bundle;
the latter needs the deployed server. Public directory search requires publication.

```sh
npm run package:web
```

This creates a bundle with no MCP or registered-app configuration files. Its
availability in your web account still depends on completing the host's import,
installation or publication flow.

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
| `npm run package:web` | Web skills upload bundle; no MCP configuration files |
| `npm run package:plugin` | Twelve skills; no server dependency |
| `npm run package:plugin -- --skills-only` | Explicit skills-only package |
| `npm run package:plugin -- --app-id asdk_app_YOUR_ID` | Skills plus optional registered app |
| `npm run package:plugin -- --url http://localhost:3000/mcp` | Local desktop MCP development package |

Production packaging additionally checks the actual HTTPS endpoint and publisher policy URLs. It never registers, deploys or publishes a service automatically.

## Installed, connected and remembered are different states

The host manages installed skills and their availability in new chats. The Copilot app stores only reviewed writing preferences saved through its authenticated context tool. It does not install into ChatGPT memory, run continuously in the background or silently authorize LinkedIn actions. Ordinary drafting uses the context available in the current conversation.


## Downloaded repository vs active skills

Downloading the repository into a host's skills directory previously left no
`SKILL.md` at that directory's root. Version 2.1.2 adds the missing standalone
entry point. A host that discovers this path can activate `linkedin-copilot-chatgpt`
and follow its links to all twelve bundled workflows. This is one entry point,
not a claim that the twelve nested folders were separately registered.

If a file-capable Work environment already downloaded the repository, ask it:

```text
Update the downloaded linkedin-copilot-chatgpt repository from origin/main,
preserving any local edits. Load its root SKILL.md and use the audit workflow.
Check the LinkedIn tools already available in this chat before asking me to
connect anything. Use them if they expose my posts and comparable metrics.
```

That request can apply the instructions in the current file-capable conversation.
It does not guarantee account-wide web installation; the host's supported skill
or plugin installation controls determine persistence and discovery. Installing
individual `skills/linkedin-*` folders is also supported by a local skill installer;
use the native plugin when all twelve must appear as individual plugin skills.

## Connected does not mean every LinkedIn capability is available

The workflows prefer existing authorized tools that match the request. They do
not require this repository's MCP tool names when an equivalent connected tool
exists. ChatGPT must inspect the actual tool catalog, not infer it from a plugin's
name. A connector's tokens are never copied into the Copilot backend.

If the active LinkedIn tool only searches people, the skills can use its returned
profile information where relevant, but cannot retrieve your posts, impressions
or inbox. Installing more instructions or reconnecting the same search-only
connector does not add those operations. An automatic performance audit needs a
tool exposing authorized post IDs and comparable metrics. Otherwise supplied
data is the available fallback. See [connector selection](../skills/CONNECTORS.md).
