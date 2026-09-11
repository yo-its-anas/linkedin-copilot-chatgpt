---
name: linkedin-copilot-chatgpt
description: Use LinkedIn Copilot to draft posts, audit supplied or connected post data, plan content, humanize writing, create carousel copy, repurpose material, review profiles and prepare engagement replies. Coordinates twelve bundled workflows and uses suitable LinkedIn tools already available in the chat.
---

# LinkedIn Copilot for ChatGPT

Built by Muhammad Anas. This is the standalone entry point for a host that
installs the repository root as one skill. The native plugin separately exposes
the twelve skills under `skills/`. Do not claim that downloading files registers
all twelve individually or installs anything into ChatGPT memory.

## Start using it

For a LinkedIn request, load the matching workflow below and complete the task.
Do not require a second plugin installation merely to read these bundled
instructions. Do not run npm, build the server, or request OAuth to draft content.
Ask only for missing source material or facts that affect the result.

Before any connected-data request, read [connector selection](skills/CONNECTORS.md).
Use a suitable tool already available in the current chat. If an authorized tool
can perform the operation, a separate Copilot backend connection is unnecessary.
A search tool does not establish access to the user's posts or analytics.

| Request | Workflow |
| --- | --- |
| Write a post or hooks | [Post](skills/linkedin-post/SKILL.md) |
| Plan a week | [Plan](skills/linkedin-plan/SKILL.md) |
| Audit posts or find the best performer | [Audit](skills/linkedin-audit/SKILL.md) |
| Review profile content | [Profile](skills/linkedin-profile/SKILL.md) |
| Improve voice and clarity | [Humanize](skills/linkedin-humanize/SKILL.md) |
| Create carousel copy | [Carousel](skills/linkedin-carousel/SKILL.md) |
| Repurpose long-form material | [Repurpose](skills/linkedin-repurpose/SKILL.md) |
| Draft comments | [Comment](skills/linkedin-comment/SKILL.md) |
| Reply to comments | [Reply](skills/linkedin-reply/SKILL.md) |
| Draft private outreach | [DM](skills/linkedin-dm/SKILL.md) |
| Triage supplied conversations | [Inbox](skills/linkedin-inbox/SKILL.md) |
| Coordinate a compound task | [Router](skills/linkedin-router/SKILL.md) |

Make all workflows available through this entry point; load detailed instructions
only when relevant. Continue revisions and related deliverables in the same chat.
Host skill discovery determines whether this entry point appears in future chats;
a local download is not a universal account installation.

## Account actions and results

Discover actual tools and follow their schemas and host approval controls. Drafts
never authorize publication. Report a completed action only after a successful
tool result. Never copy credentials between connectors or substitute public
people-search data for private account analytics. If no available tool can fetch
posts and metrics, explain that specific limitation once and use supplied data.

The included MCP server is optional infrastructure for operators, not a required
runtime for these writing workflows. Its own account tools use separate OAuth.
