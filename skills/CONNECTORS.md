# Use the LinkedIn tools available in this chat

This contract applies to each Copilot workflow. The `linkedin_*` tool names in
individual skills describe this repository's optional MCP backend. They are not
an exclusive list of tools that ChatGPT may use. Host-connected tools can have
different names and schemas.

## Select by the requested operation

1. Inspect or discover relevant tools actually available to this conversation.
   Prefer an existing authorized LinkedIn connection that supports the operation.
   Do not request a new Copilot connection just because its own tool is absent.
2. Check the tool description, input schema, account scope and returned fields.
   Identify the correct connected account when multiple accounts are available.
   Follow that tool's contract, not the argument names of a different connector.
3. Use the tool within the user's request and host permissions. Reuse its returned
   data in the workflow, identifying the source and coverage where relevant.
4. If the capability exists but needs authentication, use that connector's normal
   linking flow. If the capability does not exist, more login prompts will not
   create it. Explain the missing operation and offer the smallest useful fallback.

## What an audit actually needs

| Available capability | What an audit can do |
| --- | --- |
| People/profile search only | Profile research from returned fields; no private post ranking |
| Own-post listing without metrics | Editorial review; no performance winner |
| Own-post metrics for known IDs only | Compare supplied authorized IDs; cannot discover every post |
| Own-post listing plus comparable metrics | Rank the retrieved sample by the user's objective |
| No appropriate connected tools | Analyze supplied posts/exports and label coverage |

For "Find my best-performing post", discover authorized post-listing and metric
capabilities before requesting files. If only search is available, say so once.
Do not call it a missing skill, pretend analytics are connected, or promise that
reconnecting the same search-only integration will expose metrics. A manually
supplied export remains a fallback, not automatic account access.

## Keep authorization and identity separate

Using a host-connected tool does not connect it to this repository's MCP server.
Never obtain, copy or ask for another connector's OAuth tokens. Its own host
permissions govern its calls; Copilot's broker scopes govern Copilot server calls.
Do not use `linkedin_get_connection_status` as a test of another connector.
Copilot's saved preferences likewise require its own authenticated context tools;
ordinary drafts can use conversation context.

For supported writes, review the exact content, target and visibility and obey the
selected tool's approval requirements. Use a `request_id` only if its schema
supports one. Uncertain outcomes require reconciliation, not retrying through a
different connector. A denial is not a reason to seek a less restricted tool.

Do not mislabel a third-party connector as this Copilot. Use it only for the
capabilities it exposes; the optional Copilot backend still has the documented
API limits. These instructions do not register new tools, add scopes, enable
scraping, authorize background work or expand the user's request.
