# Outbox
SQL supports SKIP LOCKED claims, leases, retry and dead letters. The BullMQ worker currently processes named queues and has no generic outbox dispatcher. Delivery remains at-least-once.
