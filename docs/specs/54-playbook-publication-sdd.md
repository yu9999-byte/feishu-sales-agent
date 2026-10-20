# Playbook publication and withdrawal

## Scope

9c1 adds tenant-wide published Playbooks to the existing knowledge workspace.
It does not publish to Feishu, index RAG, infer adoption, or infer win/loss examples.
All acceptance runs use synthetic tenants in the isolated test database.

## Authorization and API

- `GET /api/platform/playbook-candidates/:id/publication`: `playbook:review`.
- `POST /api/platform/playbook-candidates/:id/publication`: `playbook:publish` (existing admin permission).
- `GET /api/platform/playbooks[?afterCandidateId=uuid]`: `playbook:read`.
- `GET /api/platform/playbooks/:id`: `playbook:read`; absent, unpublished, withdrawn or foreign tenant returns 404.
- Tenant/member come only from authenticated sessions. All responses use no-store.
- Readers receive only published title, body, applicability, frozen source references,
  version, publication sequence and time. Drafts, audit notes and member IDs stay private.

## State and concurrency

Append immutable publish/withdraw events with a per-candidate sequence.
Lock the candidate row, sharing the serialization boundary with draft saves and reviews.
Publish requires accepted_for_authoring, latest draft version, current approve for
that exact version, matching review sequence and publication sequence, and no active
publication of the same version. Publishing a newer approved version replaces the active version.
Saving/reviewing another draft never changes the active publication.
Withdrawal requires only the active version and publication sequence; it deliberately
does not depend on current draft/review/acceptance status. A withdrawn version can be
republished only if it is still the latest approved version.

Request IDs are tenant/candidate scoped. Replaying identical actor, action, normalized
note and expectations returns the original event even after later operations. A changed
payload/actor conflicts. Replays are checked before eligibility/CAS, after tenant lookup.
POST returns an audit event, not proof of current publication; the UI must read current
state after every success/replay. Unknown write outcomes retain the exact request for
retry and freeze edits. A failed post-write read hides stale state and blocks new writes.

Reads of draft, review, active content and audit page use one repeatable-read snapshot.
Audit uses descending exclusive integer cursors, 20 per page; catalog uses ascending
exclusive candidate UUID cursors, 20 per page. Concurrent publication may require refresh.
Foreign member/version references are constrained in PostgreSQL. Tenant removal cascades
audit cleanup while preserving member/version references during normal operation.

## UI acceptance

- Existing draft workspace gains a publication tab, exact approved preview, active
  published version, explicit publish/withdraw confirmation, note and audit history.
- Current publication never uses the workspace's local unsaved draft as content.
- Sales users browse a published catalog and fetch current content on opening it.
- 409 clears stale state, preserves note and requires successful refresh.
- 401/403/404 clear sensitive state; changing candidates ignores late responses.
- Tabs and long content fit desktop and 390px viewports.

## Verification

Real failing HTTP tests precede implementation. Isolated PostgreSQL/HTTP tests cover
approval, stale expectations, concurrent writes, identical retries, replacement,
withdrawal after a new draft, replay after withdrawal, authorization and tenant isolation.
Component tests cover confirmation, uncertain outcomes, refreshed truth and access loss.
Type checks, lint, build and full unit tests must pass before milestone checkpoint.
