import type { Database, TransactionClient } from "../client";
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

/**
 * Pilot command boundary: mutation, audit record, and delivery intent commit
 * together. If `mutate` throws, PostgreSQL rolls back all three writes.
 */
export function executeAuditedOutboxCommand<T>(
  db: Database,
  command: AuditedOutboxCommand<T>,
) {
  if (command.audit.teamId !== command.outbox.teamId) {
    throw new Error("Audit and outbox events must belong to the same team");
  }
  if (command.audit.correlationId !== command.outbox.correlationId) {
    throw new Error("Audit and outbox events must share a correlation ID");
  }

  return db.transaction(async (tx) => {
    const result = await command.mutate(tx);
    const auditEvent = await createAuditEvent(tx, command.audit);
    const outbox = await enqueueOutboxEvent(tx, {
      ...command.outbox,
      causationId: command.outbox.causationId ?? auditEvent.id,
    });
    return { result, auditEvent, outbox: outbox.event, outboxCreated: outbox.created };
  });
}
