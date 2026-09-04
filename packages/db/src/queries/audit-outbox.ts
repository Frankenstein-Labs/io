import { and, eq } from "drizzle-orm";
import type { Database, DatabaseOrTransaction } from "../client";
import { auditEvents, outboxEvents } from "../schema";

export type TraceContext = {
  correlationId: string;
  causationId?: string;
  requestId?: string;
};

export type CreateAuditEventParams = TraceContext & {
  teamId: string;
  actorId?: string;
  actorType: "user" | "service" | "system";
  action: string;
  objectType: string;
  objectId: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  source: string;
  result: "success" | "failure" | "denied";
  reason?: string;
};

export async function createAuditEvent(
  db: DatabaseOrTransaction,
  params: CreateAuditEventParams,
) {
  const [event] = await db
    .insert(auditEvents)
    .values({ ...params, metadata: params.metadata ?? {} })
    .returning();
  return event!;
}

export type EnqueueOutboxEventParams = TraceContext & {
  teamId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

/**
 * Enqueue using a tenant-scoped idempotency key. Call inside the same database
 * transaction as the domain write and its audit event.
 */
export async function enqueueOutboxEvent(
  db: DatabaseOrTransaction,
  params: EnqueueOutboxEventParams,
) {
  const [created] = await db
    .insert(outboxEvents)
    .values(params)
    .onConflictDoNothing({
      target: [outboxEvents.teamId, outboxEvents.idempotencyKey],
    })
    .returning();

  if (created) return { event: created, created: true };

  const [existing] = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.teamId, params.teamId),
        eq(outboxEvents.idempotencyKey, params.idempotencyKey),
      ),
    );
  if (!existing) throw new Error("Outbox idempotency conflict could not be read");
  return { event: existing, created: false };
}

/** Server-side tenant-scoped read; routes/MCP tools must pass the authorized team. */
export function getAuditEventsForTeam(
  db: Database,
  teamId: string,
  options: { objectType?: string; objectId?: string } = {},
) {
  const conditions = [eq(auditEvents.teamId, teamId)];
  if (options.objectType) conditions.push(eq(auditEvents.objectType, options.objectType));
  if (options.objectId) conditions.push(eq(auditEvents.objectId, options.objectId));
  return db.select().from(auditEvents).where(and(...conditions));
}

/** Marks an event processed only once; consumers treat a false result as a duplicate. */
export async function markOutboxEventProcessed(
  db: DatabaseOrTransaction,
  eventId: string,
) {
  const result = await db
    .update(outboxEvents)
    .set({ status: "processed", processedAt: new Date().toISOString() })
    .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.status, "processing")))
    .returning({ id: outboxEvents.id });
  return result.length === 1;
}
