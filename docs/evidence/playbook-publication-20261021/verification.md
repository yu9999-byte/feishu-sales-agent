# Playbook publication verification (2026-10-21)

This milestone implements 9c1 in [SDD 54](../../specs/54-playbook-publication-sdd.md).
It adds admin publication/withdrawal, exact version approval, append-only audit,
idempotent recovery, and sales access to current published catalog/content.
It does not execute a real tenant publication, call Feishu, index RAG, record adoption,
or infer win/loss patterns.

## Tests

- [Actual Red](red.log): before implementation, the approved-version publication HTTP
  test failed with 404 instead of 201. No failed result was reconstructed from Green.
- [PostgreSQL/HTTP Green](integration-green.log): 2 files, 32 tests pass. New suite includes
  concurrency, exact retries, stale CAS, latest approval, replacement, new-draft withdrawal,
  replay after withdrawal, changed actor/payload, permissions, identity whitelisting,
  tenant isolation, references, reconnect persistence, audit/catalog pagination and boundaries.
- [Full unit Green](unit-green.log): 136 files, 1262 tests pass.
- Component cases cover explicit confirmation/cancel, frozen uncertain requests,
  refreshed truth after replay, failed post-write reads, conflict recovery, sensitive-state
  cleanup, late responses, reviewer permissions and fresh catalog reads.
- Migration 035 applied to the existing isolated PostgreSQL 17.7 on loopback port 55437.
  The test suites delete only their random synthetic tenants and close their Nest apps/connections.
  A second migration run skipped every migration, including 035.

| Quality gate | Result |
| --- | --- |
| Server/client type checks | Pass |
| Test type check | Pass |
| Full ESLint/Stylelint and lint wrapper | Pass |
| Agent build | Pass, 208 files |
| Web build | Pass, 3057 modules; existing Vite module-format warnings |

JSON `null` bodies are rejected by Express with 400 before controller parsing; other
well-formed JSON with invalid publication fields returns 422. No record is created.

## Browser evidence

Actual `PlaybookDraftWorkspace`, publication panel and published catalog were mounted
with real agent-web CSS and a temporary read-only synthetic API. This verifies component
layout and interaction, not real Feishu login, role permissions or production UAT.

| View | Evidence |
| --- | --- |
| Desktop workspace, empty note | [Screenshot](workspace-desktop-empty.jpg) |
| Desktop publish confirmation | [Screenshot](workspace-desktop-confirm.jpg) |
| 390px workspace and wrapped tabs | [Screenshot](workspace-mobile-empty.jpg) |
| 390px publish confirmation | [Screenshot](workspace-mobile-publish-confirm.jpg) |
| 390px withdrawal confirmation | [Screenshot](workspace-mobile-withdraw-confirm.jpg) |
| Desktop published content | [Screenshot](catalog-desktop.jpg) |
| 390px published content | [Screenshot](catalog-mobile.jpg) |

[Measured layout](layout-measurements.json): no horizontal overflow at 1280x900 or 390x844.
Tabs wrap to two rows at 390px; new tabs and publication buttons measure 44px high.
Long source identifiers wrap. Empty notes disable commands; valid notes enable explicit
version-bound confirmation. Browser never clicked a final publish/withdraw button.
Final browser error log was empty.

The first temporary preview imported platform `index.css`, which references absent
`inspector.dev.css`. Switching the temporary entry to the actual product's `agent-web/agent.css`
resolved it. The temporary files, 5175 server and browser tab were removed after verification.
The previous 3100/5174 instances were preserved. The legacy runtime still logs connection
refused to the stopped 55432 business database; passing isolated tests does not prove its health.

## Remaining

Real identity UAT, real publication authorization/execution and deployment remain separate.
9c2 trusted adoption and 9c3 evidence-based win/loss candidates are next in the execution plan.
Audio transcription, long-term memory services, complete task-history source and real
sales acceptance still require the external dependencies already listed in the master checklist.
