# Migration to LinkedIn Copilot for ChatGPT 2

The original repository was an eleven-skill Claude writing pack. This version
preserves its editorial methods while adding native ChatGPT skill packaging,
natural-language orchestration, a remote MCP app, and official LinkedIn OAuth.
The original MIT license and Jake Schincariol attribution remain intact.

| Previous command | Installed skill | Preserved methodology |
| --- | --- | --- |
| `/li-post` | `linkedin-post` | 21 hooks, three alternatives, one truthful idea and a full draft |
| `/li-plan` | `linkedin-plan` | Proof/opinion/teach/story/offer mix; 5/3/2 engagement planning |
| `/li-audit` | `linkedin-audit` | Engagement rate, comment ratio, reach multiple and account evidence |
| `/li-profile` | `linkedin-profile` | Twelve-part, 100-point rubric; prioritize the largest useful fixes |
| `/li-human` | `linkedin-humanize` | Plain-language lexicon, structural review and five local style heuristics |
| `/li-carousel` | `linkedin-carousel` | Cover, stakes, one idea per slide, recap and CTA |
| `/li-repurpose` | `linkedin-repurpose` | Extract claims, numbers, stories, mechanisms, mistakes and quotable lines |
| `/li-comment` | `linkedin-comment` | Nine distinct ways to contribute to a post |
| `/li-reply` | `linkedin-reply` | Lead/substance/peer/support/noise triage |
| `/li-dm` | `linkedin-dm` | A specific reason to contact, modest ask and up to two useful follow-ups |
| `/li-inbox` | `linkedin-inbox` | Lead/recruiter/peer/ask/spam triage |

`linkedin-router` coordinates compound requests. Ask “What should I post this
week?” instead of using a slash command. The server does not execute the offline
regex routing helper; ChatGPT uses installed skill descriptions and instructions.

## Removed and replaced behavior

- Removed `.claude-plugin` manifests, Claude installation commands, and implicit
  reads/writes of `~/.claude/linkedin/voice.md`, `plan.md` and `log.md`.
- Portable `plugin.json`, registered-app mapping and MCP wiring replace the old
  plugin entry. `.codex-plugin/plugin.json` is an OpenAI-supported compatibility
  overlay; it does not make this a Claude Code skill pack.
- Installed skills are immutable. Split private preferences into the six
  `user-profile/` sections and save them with authenticated context tools. To
  migrate an old voice file, supply its non-secret contents, review the six
  proposed sections, and ask ChatGPT to save them. No script reads home-directory
  private files automatically. Plans and logs can be supplied as source material;
  they are not silently uploaded or treated as publishing history.
- Drafts still work without LinkedIn access. Explicit publication requests can
  now invoke supported, permission-annotated MCP writes. Unsupported operations
  return manual drafts. No browser automation or scraping fallback exists.
- Removed absolute claims about algorithm weights, posting times, invite limits,
  and guaranteed reach. These become editorial hypotheses to test with evidence.
- Humanizer scripts preserve meaningful Unicode, joiners, emoji and typography
  by default. Optional punctuation normalization is an editing choice. Links,
  code and double-quoted text are protected. The five-check panel is a style
  heuristic, never proof of AI authorship or a promise to evade a detector.
  Python JSON output uses `style_score` rather than `human_score`, and a low style
  score is no longer a process failure.

## Compatibility limits

Old slash command names and paths are intentionally no longer installed. The
eleven workflows plus router ship together in a plugin ZIP. Do not rely on MCP
Scan Tools to import twelve skills: its documented draft import path currently
accepts at most five; upload the final skill bundle instead. All live API actions
need real deployment configuration and the grants listed in the
[capability matrix](docs/LINKEDIN_API_MATRIX.md).
