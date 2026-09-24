# Workspace Automation

## GitHub checkpoints

The user has authorized automatic checkpoints to the `github/main` branch through the
project publisher. The publisher captures all non-ignored working-tree changes without
changing the current branch or index.

Run a milestone checkpoint after all of these are true:

- A core module or cohesive feature is functionally complete.
- Its acceptance criteria and relevant tests pass.
- The repository is at a useful rollback point rather than an intermediate edit state.
- The checkpoint can be summarized accurately in 72 characters or fewer.

Use:

```text
npm run github:publish -- --kind milestone --summary "<completed outcome>"
```

Do not publish partial scaffolding, failing work, cosmetic-only edits, unresolved security
findings, or changes whose acceptance status is unclear. Do not bypass the publisher's
safety or quality gates. The daily Codex automation is only a fallback; a verified core
module or project stage should be checkpointed immediately.
