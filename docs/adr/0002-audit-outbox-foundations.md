# ADR 0002: Append-only audit and transactional outbox foundations

**Status:** Accepted — incremental foundation (Phase 1B)  
**Date:** 2026-09-04

## Context and decision

Midday keeps its existing transactional models and `activities` product feed. New critical commands will progressively use a separate immutable audit record and a transactional outbox. A command carries a `correlationId` from request to external effect; each downstream event records the immediate `causationId`. An idempotency key is scoped to a tenant and event intent.

`audit_events` is append-only evidence, not a financial ledger. It includes actor/service identity, tenant, before/after values, trace IDs, outcome, and reserved hash/signature fields. `outbox_events` records a delivery intent in the same PostgreSQL transaction as the domain mutation and audit event. Consumers claim/deliver independently and must use the idempotency key at the external boundary.

The future financial event core will be a separate append-only, balanced journal model. Its projections will not overwrite original source records. Evidence will be linked by stable object references now and later by immutable document version/hash records.

## Guarantees and boundaries

- The command helper rejects mismatched tenant or correlation IDs before opening a transaction.
- Database triggers reject `UPDATE` and `DELETE` on `audit_events`; an attempted alteration is observable as a database error.
- RLS permits authenticated tenant members to select the new tables; normal client roles receive no insert/update/delete policy. Server query helpers also require `teamId`.
- The unique `(team_id, idempotency_key)` constraint deduplicates outbox production. Processing transitions only from `processing` to `processed`.
- PostgreSQL table owners, superusers, and privileged migration roles can bypass RLS/triggers. Production must use a non-owner application role, segregate migration credentials, restrict direct SQL, preserve backups/WAL, and log break-glass access. A future hash chain/signature is defence in depth, not a substitute for these controls.

## Consequences

No existing financial flow, job, webhook, MCP tool, Assistant capability, or `activities` behavior is migrated in this phase. The pilot boundary is available to one safe future command only after its authorization and retry semantics are tested. The API/backend remains the authorization point; frontend and AI never authoritatively create financial facts.
