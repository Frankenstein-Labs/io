# Current state

## Resume point

The current branch is `codex/enterprise-financial-foundations`; the continuity
commit is `f4719e4`. The latest financial implementation commits are
`5dbff22`, `9125006`, `e17cd05`, and `a02f598`.

## Verified implementation

* `transactions.create` is a protected tRPC mutation. Its team is supplied by
  `withTeamPermission`; it calls the legacy `createTransaction` repository and,
  after success, schedules enrichment and matching jobs.
* Phase 4 adds the SQL financial-event, ledger, audit/outbox, evidence, role and
  SoD foundations. Phase 5 exposes their Drizzle table definitions and exact
  decimal transport.
* The worker is BullMQ queue/processor based. It has no outbox dispatcher.

## Not implemented

There is no financial command handler, capability evaluator, transactionally
posted ledger entry, outbox dispatcher, Evidence Vault upload boundary, financial
read model, or UI flow. No claim of an end-to-end financial operation is valid.

## Validation limits

Unit tests have covered exact ledger preflight and outbox retry policy. PostgreSQL
and browser integration validation is blocked because no test database/browser
session is provisioned.
