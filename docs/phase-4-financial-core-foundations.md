# Phase 4 — financial core, evidence, and reliable outbox foundations

## Scope implemented

This is an additive database foundation. It does not migrate, replace, or
recalculate existing transactions, invoices, payments, or documents. Existing
`owner`/`member` behavior remains unchanged, and no MCP tool receives a new
authority to mutate financial records.

## Reliable outbox

`outbox_events` now has worker lease metadata and a `dead_letter` terminal state.
`private.claim_outbox_events` uses `FOR UPDATE SKIP LOCKED` to atomically claim
pending work, or reclaim a stale processing lease after a bounded timeout. A
consumer must process only claimed events, call `markOutboxEventProcessed` after a
successful effect, and call `markOutboxEventFailed` on failure. Retries use capped
exponential backoff (1 second to 15 minutes) and terminally dead-letter after eight
attempts.

This provides **at-least-once delivery**, not generic exactly-once delivery: a
process can crash after an external provider accepts an effect and before Midday
marks it processed. Every external handler must therefore send the immutable
tenant-scoped outbox idempotency key to a provider-supported idempotency mechanism
or persist an external delivery receipt before retrying. Providers without such a
mechanism need a domain-specific reconciliation/confirmation flow; they must not
claim exactly-once behavior.

## Financial event and ledger foundation

`financial_events` links the tenant, server-derived actor, command,
correlation/causation IDs, entity, source, optional exact amount/currency, audit
event, and optional evidence. The command is tenant-unique to support event-level
idempotency and reconstruction without duplicating current operational tables.

The future double-entry ledger consists of `ledger_accounts`, `journal_entries`,
and `journal_lines`. Entries have a tenant-scoped idempotency key and draft/posted/
voided state. Lines use `numeric(24,8)` directly in PostgreSQL, require exactly one
positive debit or credit, and a deferred constraint trigger rejects a posted entry
whose debit and credit totals differ for any currency. This phase intentionally
does not post or backfill existing transactions.

For future financial boundaries, Midday should use **exact decimal strings** between
TypeScript and PostgreSQL for the new ledger/event amounts. This aligns with the
existing PostgreSQL numeric model while avoiding JavaScript `number` rounding.
Operational legacy columns currently mapped with `numericCasted` remain unchanged
until each domain can be migrated safely and compatibly.

## Evidence Vault and authorization foundation

`evidence_artifacts` versions explicitly supplied/imported/generated artifacts with
tenant, actor, entity/operation links, SHA-256, MIME type, byte size, provenance,
prior version, and audit reference. `evidence_access_logs` records view/download/
export access. It is not workstation surveillance. Hash validation and access-log
writes must be performed by the server-side upload/download boundary before this
becomes the backing store for existing documents.

`team_role_assignments` introduces additive enterprise roles without altering the
legacy role enum. `segregation_of_duties_policies` starts in `observe` mode and can
later be moved per tenant to `enforce`; evaluations must use the authenticated
server actor, never an actor ID supplied by a browser or an assistant.

## Remaining implementation work

Apply the migration to real PostgreSQL and add RLS policies for all new tables in
the deployment's role model; write PostgreSQL integration tests for concurrent
claims, lease recovery, dead letters, deferred ledger balance, append-only ledger
policy, cross-tenant access, evidence hash/versioning, and access logs. Integrate
the outbox consumer into the worker, then migrate one sensitive API/MCP command at
a time through authorization, confirmation, command boundary, audit, and outbox.
