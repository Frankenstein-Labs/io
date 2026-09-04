# Phase 5 — application financial-core boundary

## Implemented application components

Drizzle now exposes the Phase 4 financial, ledger, evidence, role, and SoD tables.
New ledger amounts use an exact decimal-string custom type (`numericExact`), rather
than the legacy `numericCasted` JavaScript-number mapping. The `validateLedgerLines`
service validates the same per-currency debit/credit invariant as the deferred
PostgreSQL trigger before a future posting command reaches the database.

## Deliberate limits

No existing transaction, invoice, bank, payment, MCP, or Assistant mutation has
been routed through the new ledger yet. Inspection found transaction creation is
currently a direct tRPC/API call to `createTransaction`, followed by two job
triggers; replacing it safely requires a real PostgreSQL integration suite and a
server command carrying the authenticated actor and request idempotency key. This
slice therefore does not claim a first end-to-end financial command.

Likewise, the current BullMQ worker has queue-specific processors rather than an
outbox dispatcher. The claim/retry functions are usable by a future dispatcher,
but are not wired into a worker loop until an event-type registry and external
delivery idempotency contract exist.

## Required next command

Implement a server-only manual-transaction command that derives team/actor from
tRPC context, authorizes a finance-write capability, accepts an idempotency key,
creates the legacy transaction and financial event in one transaction, optionally
posts a balanced journal entry, writes audit/outbox records, and only then triggers
enrichment. MCP must call this same command after an explicit confirmation; it may
not call the repository directly.
