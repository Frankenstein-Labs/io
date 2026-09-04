# Phase 1A foundations: glossary, critical data, and threat model

## Glossary

| Term | Definition |
| --- | --- |
| Financial event | Immutable business fact that affects financial state; future ledger source, not an AI inference. |
| Journal entry / line | A balanced accounting posting and its debit/credit components. Not yet implemented. |
| Transaction | Existing imported or manually recorded bank movement in `transactions`. |
| Payment | Settlement of an invoice or obligation; existing invoice payments remain their source today. |
| Commitment | Reserved authorization to spend before payment; future Government model. |
| Budget | Authorized allocation and constraints; future model, distinct from reporting projections. |
| Invoice | Existing receivable document and its lifecycle in `invoices`. |
| Evidence | Original professional document plus immutable identity/version/hash and chain of custody; future Evidence Vault. |
| Audit event | Append-only record of an attempted or completed sensitive action in `audit_events`. |
| Actor / service actor | Human user / authenticated service or worker responsible for an action. |
| Correlation ID / causation ID | Stable ID for one request workflow / ID of the immediate event that caused a downstream action. |
| Idempotency key | Tenant-scoped stable command/delivery key that makes retries logically single-effect. |
| Projection | Rebuildable read model derived from authoritative events. |
| Source of truth | Deterministic persisted record authorized to establish a fact; never model output. |

## Critical data catalogue (current state → target)

| Table | Fields / type | Tenant & origin | Mutable | Relations / risk | Future destination |
| --- | --- | --- | --- | --- | --- |
| `transactions` | `id` UUID, `amount` numeric, `currency`, `date`, `status` | `team_id`; bank connector/manual | Yes | account/category/attachments; imported fields can change and are not a ledger | source transaction + financial-event linkage |
| `bank_accounts` | balances, currency, provider identifiers | `team_id`; banking connector | Yes | bank connection; balance snapshot risk | account/projection |
| `invoices` | amounts, currency, status, dates | `team_id`; UI/API | Yes | customer, line items, payments; lifecycle overwrite risk | receivable event stream |
| `invoice_payments` | amount, currency, paid date | invoice/team context; API/provider | Yes | invoice settlement; duplicate retry risk | payment event linkage |
| `documents` | path, content, metadata, processing status | `team_id`; explicit upload/email ingestion | Yes | transaction/inbox objects; hash/version absent | Evidence Vault evidence/version |
| `activities` | metadata JSON, status, source | `team_id`; product services | Yes | notification feed; must not be audit evidence | retained product activity only |
| `audit_events` | actor, object, old/new JSON, trace IDs | `team_id`; backend command | append-only | tenant access and privileged DB role risk | immutable audit core |
| `outbox_events` | payload JSON, key, status, attempts | `team_id`; backend transaction | lifecycle only | delivery retry/consumer risk | integration event delivery |
| `users_on_team` | user/team/role | membership origin | Yes | authorization boundary; roles are limited | RBAC/ABAC policy input |

## Targeted threat model

| Asset / boundary | Threat | Control now | Required follow-up |
| --- | --- | --- | --- |
| Multi-tenancy | IDOR or missing team predicate | RLS select policy + tenant-required query helper | authorize team membership in every API/MCP handler; cross-tenant integration tests |
| Financial facts | retry/overwrite alters history | additive tables and tenant idempotency unique key | immutable financial journal and balanced invariants |
| Audit trail | deletion or privileged tampering | DB reject triggers, non-owner app role | hash chain, signatures, break-glass review |
| MCP / AI | tool reaches unauthorized tenant or writes without confirmation | backend authorization remains mandatory | scopes, confirmation state, per-tool audit/outbox pilot |
| Documents | malicious upload, cross-tenant access, SSRF/OCR exfiltration | explicit professional capture only | content scanning, signed URLs, egress allowlist, evidence hashes |
| Workers / webhooks | duplicate, forged, or replayed delivery | transactional intent + idempotency key | signature verification, claim lease, DLQ and replay runbook |
| Exports | bulk exfiltration | auditable future command boundary | role/field filters, approval, watermarking and expiry |
| Privileged DB | bypass of RLS/triggers | documented separation of app/migration roles | monitored break-glass, backup/WAL retention, periodic restore drill |

## CI observation mode

`.github/workflows/staging.yml` currently sets `validate` and `eval-tool-selection` to `if: false`; this Phase does **not** re-enable them because the previous commit intentionally disabled them and reliability has not been demonstrated. They should be restored first in observation-only mode (non-required workflow/check, with result reported) after a clean run proves: database bootstrap works from the repository root, affected lint/typecheck/test commands are deterministic, and tool-selection eval secrets/fixtures are available. Required gates thereafter: migration schema application, `@midday/db` typecheck/lint/test, explicit tenant isolation tests, and API/MCP authorization tests; tool-selection evaluations become required only after their dataset and API-key failure policy are stable.
