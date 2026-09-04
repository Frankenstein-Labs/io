# Architecture
Current: UI -> protected tRPC -> team permission middleware -> query -> PostgreSQL -> BullMQ jobs. Target command pipeline is AUTH -> tenant -> authorization -> validation -> idempotency -> transaction -> financial event/ledger/audit/outbox -> dispatcher -> worker -> read model.
