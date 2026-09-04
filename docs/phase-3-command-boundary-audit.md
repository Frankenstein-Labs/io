# Phase 3 — command-boundary audit and safe hardening

## Baseline inspected

The starting branch is `c33d8c2`, which already contains the additive
`audit_events`/`outbox_events` migration and the initial dashboard modernization.
This phase inspected Drizzle/PostgreSQL schema and migrations, API/tRPC/OpenAPI,
Supabase authentication, OAuth/API scopes, the binary team-role model, MCP and
assistant tools, BullMQ/Trigger jobs, banking, transactions, invoices, customers,
documents, reports, payments, integrations, tests, and GitHub Actions.

## Observed command flow

`User or integration -> session/OAuth/API-key authentication -> API context and
scope/team checks -> route/tool mutation -> Drizzle/PostgreSQL -> activities or
audit -> job/webhook/provider effect`.

MCP and assistant actions enter through the same API surface, but prompt-level
confirmation is not a server-side authorization boundary. Workers and jobs can
produce external effects after database mutations. The new pilot boundary is:

`request -> authentication -> authorization -> validation -> idempotency claim ->
domain mutation -> audit -> outbox -> commit -> worker -> external effect`.

It is a reusable foundation only; it does not yet replace existing routes or make
the assistant a financial authority.

## Findings and decisions

* **Corrected:** the prior pilot executed `mutate` before it learned whether the
  outbox idempotency key already existed. A retried/concurrent call could therefore
  make a second domain change. The boundary now reserves the tenant-scoped outbox
  key first; a duplicate returns `executed: false` and does not invoke `mutate`.
  The reservation, mutation, audit record, and causation update are one database
  transaction, so an error rolls all of them back.
* **Audit/outbox status:** audit events have tenant, actor, trace and append-only
  trigger foundations. Outbox has tenant-scoped idempotency but still needs a
  production consumer claim/retry/DLQ implementation and real-Postgres tests.
  RLS only grants authenticated reads for these new tables; privileged server
  connections must continue to scope every query by `team_id`.
* **Authorization:** current product roles remain `owner` and `member`. Do not
  change stored roles until a compatibility design exists. Introduce capabilities
  server-side for Owner, Admin, Finance, Accountant, Approver, Auditor, Manager,
  Employee, Procurement, Treasury, and Read-only; map legacy roles first, then
  enforce per sensitive command. Separation of duties must compare server-derived
  actor IDs for creation, approval, payment, and evidence replacement.
* **Financial data:** operational monetary columns use `numeric` mapped to
  JavaScript `number`, which risks IEEE-754 rounding. No broad conversion was made.
  New ledger tables should use exact PostgreSQL numeric values transported as
  strings (or integer minor units with currency exponent), and enforce balanced
  debit/credit lines in a deferred database constraint/transactional posting
  procedure.
* **Evidence/documents:** documents lack a universal immutable version/hash and
  chain-of-custody model. An Evidence Vault should add tenant, explicit actor,
  operation link, version, SHA-256, provenance, timestamp, previous hash, and
  access audit. It must cover only explicitly supplied artifacts—never workstation
  surveillance. MIME sniffing, size/extension allowlists, malware quarantine,
  SSRF-safe fetches, short signed URLs, tenant-scoped download authorization, and
  access logs remain a focused follow-up review.
* **Sensitive operations to migrate first:** invoice send/cancel/refund/payment,
  bank connection/reconnect, transaction import/edit/delete/export, customer portal
  access, accounting synchronization, document attach/replace/download, and all
  MCP write tools. Each needs server validation, capability checks, an idempotency
  key, audit, and outbox. Payment and approval commands additionally require
  explicit server-side confirmation and separation-of-duties policy.
* **CI/CD:** staging validation and tool-selection evaluation are disabled with
  `if: false`; deployments may proceed when they are skipped. Re-enable only after
  supplying reproducible database setup and repairing any unrelated baseline
  failures, rather than changing deployment behavior in this narrow hardening
  slice.

## Verification scope

The repository provides a PostgreSQL test setup, but this environment exposes no
`TEST_DATABASE_URL` and no database service. Consequently tenant A/B RLS,
append-only UPDATE/DELETE rejection, rollback, concurrent duplicate requests,
outbox retry, and no-double-effect require execution in CI or a provisioned local
PostgreSQL instance. Static tests cover the command-boundary ordering; they do not
substitute for those database integration tests.
