# Plugin Directory submission checklist

This repository does not register, submit or publish an app. The publisher must
finish these steps with their own LinkedIn application and eligible OpenAI access.

1. **Provider readiness:** record actual LinkedIn product grants, verify Person ID
   resolution, validate every enabled endpoint under the selected version, and
   turn off capabilities the application cannot use. Self-serve OIDC alone cannot
   establish the full requested experience.
2. **Service readiness:** HTTPS endpoint, persistent storage, bounded single-node
   deployment, secrets management, backup/restore exercise, monitoring and a
   security review. Resolve all failing automated/live acceptance tests.
3. **Identity and policies:** actual publisher/contact, website, support/security
   channel, privacy policy, terms, deletion/retention procedure, truthful feature
   descriptions and regional availability. Contributor attribution is not a
   substitute for the operator's identity or legal documents.
4. **Reviewable package:** generate a `--production` ZIP with the real registered
   app ID and public policy URLs; verify resources, metadata, screenshots and
   installed behavior. The full twelve-skill bundle uses upload, not an oversized
   MCP skill-import catalog.
5. **Portal draft:** choose the remote MCP submission path, provide the endpoint
   and OAuth setup, complete the displayed domain ownership challenge, scan tools,
   upload the final skills, and document accurate annotation/scope justifications.
   Host the actual challenge value at the requested well-known path on the
   proxy/domain; no invented challenge token is shipped in this server.
6. **Reviewer tests:** supply at least five positive and three negative cases,
   with reproducible approved demo access and fixtures. The cases in
   [CHATGPT_TESTING.md](CHATGPT_TESTING.md) are a starting set; provide real test
   evidence and authorized access rather than credentials in repository files.
7. **Review and publish:** complete attestations only after verifying the service
   and package. Submit for review. After approval, choose when to publish. Workspace
   publication, local install and public directory publication are distinct.

Current official submission guidance supports skills-only, MCP-only and combined
plugins. A successful build is not approval or publication.
[OpenAI submission guide](https://developers.openai.com/plugins/deploy/submission).
