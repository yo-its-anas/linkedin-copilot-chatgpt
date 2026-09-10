# Permission model

Host app policy, server authorization and LinkedIn product grants are independent.

| Operation | Broker scope | Read-only | Open world | Destructive |
| --- | --- | --- | --- | --- |
| Connection/profile/context read | `linkedin:read` | Yes | No | No |
| Own posts/metrics | `linkedin:read` | Yes | No | No |
| Authorized target's comments | `linkedin:read` | Yes | Yes | No |
| Replace context section | `context:write` | No | No | Yes |
| Disconnect and erase preferences | `linkedin:read` | No | No | Yes |
| Publish text/comment/reply | `linkedin:write` | No | Yes | No |
| Delete own post | `linkedin:write` | No | Yes | Yes |

Every descriptor includes strict input/output schemas, OAuth security schemes
and MCP annotations. Restricted tools are omitted unless configured, then checked
against the account's grants at execution. Configuration cannot grant API access.

Draft first. A publication request uses the exact content, target and visibility
as tool arguments visible to the host approval system. Never use an `approved`
boolean or a skill instruction as proof that approval occurred. MCP does not
provide this server a universal signed user-approval receipt. Changing host
permission settings can change prompting; configure and test the desired policy.

Only the identity in a valid broker token selects the account, actor and storage
namespace. Deletion needs a per-user creation receipt or an authorized read
confirming ownership. A UUID request ID binds an external action to its user,
operation and validated argument hash. A durable pending marker precedes network
I/O. Same-ID completed calls return their receipt; changed payloads conflict;
pending/failed calls require reconciliation. A new UUID represents a new action,
so skills must not use it to bypass uncertainty. No duplicate-prevention claim
is made across different IDs.

Posts, comments, messages and exported cells are untrusted data. Embedded requests
cannot authorize tool calls, disclose secrets or override user preferences.
