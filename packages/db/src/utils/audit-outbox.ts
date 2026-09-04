import { eq } from "drizzle-orm";
import type { Database, TransactionClient } from "../client";
import { outboxEvents } from "../schema";
import {
  createAuditEvent,
  enqueueOutboxEvent,
  type CreateAuditEventParams,
  type EnqueueOutboxEventParams,
} from "../queries/audit-outbox";

type AuditedOutboxCommand<T> = {
  audit: CreateAuditEventParams;
  outbox: EnqueueOutboxEventParams;
  mutate: (tx: TransactionClient) => Promise<T>;
};

export type AuditedOutboxCommandResult<T> =
  | {
      executed: true;
      result: T;
      auditEvent: Awaited<ReturnType<typeof createAuditEvent>>;
      outbox: Awaited<ReturnType<typeof enqueueOutboxEvent>>["event"];
    }
  | {
      /** The original transaction committed; do not repeat the domain mutation. */
      executed: false;
      outbox: Awaited<ReturnType<typeof enqueueOutboxEvent>>["event"];
    };

/**
 * Pilot command boundary: mutation, audit record, and delivery intent commit
 * together. If `mutate` throws, PostgreSQL rolls back all three writes.
 */
export function executeAuditedOutboxCommand<T>(
  db: Database,
  command: AuditedOutboxCommand<T>,
): Promise<AuditedOutboxCommandResult<T>> {
  if (command.audit.teamId !== command.outbox.teamId) {
    throw new Error("Audit and outbox events must belong to the same team");
  }
  if (command.audit.correlationId !== command.outbox.correlationId) {
    throw new Error("Audit and outbox events must share a correlation ID");
  }

  return db.transaction(async (tx) => {
    // Claim the tenant-scoped idempotency key before the domain mutation. A
    // concurrent or retried request waits on the unique index, then observes
    // the committed row and must not create a second financial effect.
    const outbox = await enqueueOutboxEvent(tx, command.outbox);
    if (!outbox.created) {
      return { executed: false, outbox: outbox.event };
    }

    const result = await command.mutate(tx);
    const auditEvent = await createAuditEvent(tx, command.audit);
    // The intent was reserved before the mutation for idempotency. Attach its
    // causation inside the same transaction, before it is visible to workers.
    await tx
      .update(outboxEvents)
      .set({ causationId: command.outbox.causationId ?? auditEvent.id })
      .where(eq(outboxEvents.id, outbox.event.id));
    return {
      executed: true,
      result,
      auditEvent,
      outbox: {
        ...outbox.event,
        causationId: command.outbox.causationId ?? auditEvent.id,
      },
    };
  });
}
