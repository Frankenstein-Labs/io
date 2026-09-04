# Command pipeline

## Current path

`UI -> protectedProcedure -> withTeamPermission -> createTransaction -> jobs`.
The team comes from authenticated server context, but the legacy path has no
financial capability, command idempotency header, financial event, ledger entry,
audit record, or transactional outbox event.

## Required path

`authenticated actor -> tenant context -> capability -> SoD observe/enforce ->
validated command -> tenant+type+key idempotency -> one PostgreSQL transaction
(business row, financial event, journal entry/lines, audit, outbox) -> dispatcher
-> BullMQ -> idempotent handler -> read model`.

Only a server command may own this path. UI, API integrations and MCP must call
it; the Assistant may create a draft but cannot bypass confirmation or controls.
