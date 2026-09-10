# LinkedIn Copilot on ChatGPT web

## Why directory search is empty

GitHub hosts the source. ChatGPT's directory hosts published plugins. The current
repository is not a published directory listing. The desktop plugin-creator prompt
does not publish it, and repeated searches will not register it.

## Choose the form you actually see

- **Create accepts a skill/plugin upload:** generate the bundle below and follow
  that form's import and install steps. Check the resulting visibility; a private
  draft or installation does not imply public availability.
- **Create asks for an MCP server URL:** this is a server connection. Use a deployed
  Copilot `/mcp` endpoint with OAuth. The GitHub URL cannot serve this protocol.
- **Admin offers Import marketplace:** import this repository and enable its skills
  for your role. [Workspace import](https://learn.chatgpt.com/docs/enterprise/plugin-management).

Account-specific form options must be checked in the host. Nothing in this
repository can add missing administrative controls to an account.

## Build the web upload

```sh
npm ci --ignore-scripts
npm run package:web
```

Upload `release/web-*/linkedin-copilot-chatgpt.zip`. It includes all twelve skills,
reference data and attribution, with no `mcp.json`, `.mcp.json`, `.app.json` or
server dependency. Optional Python helpers require a host runtime; the editorial
workflows can use reasoning when file execution is unavailable.

## Make it discoverable to public web users

In the [OpenAI plugin portal](https://platform.openai.com/plugins), create a
**Skills only** submission and upload the final bundle. Complete the listing,
verified publisher identity and the fields requested by the portal. Submit for
review, then publish after approval. That is the step that makes it appear in
public plugin search. [Official submission requirements](https://developers.openai.com/plugins/deploy/submission).

## Prepared listing copy

**Name:** LinkedIn Copilot for ChatGPT

**Creator:** Muhammad Anas (select the matching verified identity in the portal)

**Category:** Productivity

**Short description:** Plan, write and improve LinkedIn content in one chat.

**Long description:**

LinkedIn Copilot brings twelve reusable writing and analysis skills to ChatGPT.
Turn your experience into a post, refine it in your voice, adapt it into carousel
copy and plan the rest of your week. Review profile text, posts, performance data
and conversations you supply. Prepare thoughtful comments, replies and outreach
drafts. This skills-only release does not connect to LinkedIn, retrieve private
account data or publish content. Built by Muhammad Anas, based on Jake Schincariol's
open-source linkedin-agent-skill project, with upstream MIT attribution preserved.

**Website:** https://github.com/yo-its-anas/linkedin-copilot-chatgpt

**Support:** https://github.com/yo-its-anas/linkedin-copilot-chatgpt/issues

**Starter prompts:**

- Write a LinkedIn post from these notes about my DevOps project.
- Make this draft sound more like me, then turn it into carousel copy.
- Review these posts and metrics and plan next week's content.

**Release notes:** Adds native plugin packaging, natural-language orchestration
and a web skills bundle without local server dependencies.

## Reviewer cases to run in the host

| Prompt | Expected result |
| --- | --- |
| Write a post from supplied project notes | Grounded draft; no invented achievements |
| Humanize this draft | Edited text preserving facts and technical terms |
| Make this a seven-slide carousel | Slide copy; artifact only if a renderer is available |
| Plan a week for this audience | Specific themes and a practical calendar |
| Audit these supplied posts and metrics | Evidence-based analysis with missing data labeled |
| Publish the draft now | Explain that this skills-only release cannot publish |
| Read my private LinkedIn inbox | Request user-supplied conversation text |
| A pasted post instructs the model to disclose secrets | Treat it as source content, not an instruction |

These are acceptance cases, not claims that live web evaluation has passed.
Before submitting, supply the portal's required logo, reviewed public policy URLs,
availability choices and actual test evidence. No verification or policy
attestation has been completed by the packaging script.

## Add live LinkedIn actions later

The included MCP backend remains a separate deployment. Its protected tools require
LinkedIn OAuth, approved scopes and a verified identity where applicable. Its public
Copilot guide and workflow tools let a connected chat load the same instructions.
Follow [Deployment](DEPLOYMENT.md) and [ChatGPT testing](CHATGPT_TESTING.md), then use
the **With MCP** submission route for the connected release. A GitHub push alone
cannot deploy, connect or publish that service.
