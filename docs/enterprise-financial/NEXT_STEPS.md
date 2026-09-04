# Next steps

1. Provision PostgreSQL and apply/test migration 0040 with its real triggers and RLS.
2. Add server tenant/actor/capability context and tenant-scoped repositories.
3. Implement one idempotent manual-transaction command with an atomic legacy
   transaction + financial event + balanced journal + audit + outbox write.
4. Add an outbox event registry and dispatcher to the existing BullMQ worker.
5. Prove the complete path in PostgreSQL integration and browser tests before
   adding MCP write support or a new financial UI.
