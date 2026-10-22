# Playbook adoption verification (2026-10-23)

This slice implements 9c2 in [SDD 55](../../specs/55-playbook-adoption-sdd.md).
It records only evidence-backed adoption of the current published Playbook version.
It does not publish or withdraw a real tenant Playbook, send Feishu messages, or write
new customer, opportunity, follow-up, or task data.

## Automated checks

- `tests/unit/playbook-adoption.spec.ts`: 25/25 passed.
- `tests/unit/playbook-adoption-panel.spec.ts`: 6/6 passed, including success, withdrawal
  confirmation, conflict refresh with input retention, and 401/403/404 cleanup.
- Existing publication panel regression plus adoption tests: 44/44 passed.
- `tests/integration/playbook-adoption.integration.ts`: 3 tests are configured for isolated
  PostgreSQL/HTTP. This workspace run skipped them because `DATABASE_URL` was not configured;
  no business database was started or changed.
- `npm run type:check:test`: passed.

The migration runner now includes `036_playbook_adoptions.sql`. The temporary PostgreSQL
integration command remains configured for port 55437 with `-o "-p 55437 -h 127.0.0.1"`;
this run did not start it. The legacy 55432 database and 3100/5174 services were not touched.

## Remaining acceptance

Real Feishu identity and tenant UAT must verify the permission matrix, a genuine successful
action result, the published-version binding, and a readback of the adoption audit. 9c3 win/loss
candidate discovery remains separate and must consume only these verified samples.

