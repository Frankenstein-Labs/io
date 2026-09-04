import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../migrations/0039_add_audit_and_outbox_events.sql", import.meta.url),
  "utf8",
);

describe("audit/outbox database foundations", () => {
  test("creates append-only audit evidence with actor, tenant, and trace fields", () => {
    expect(migration).toContain("CREATE TABLE audit_events");
    expect(migration).toContain("team_id uuid NOT NULL");
    expect(migration).toContain("actor_id uuid");
    expect(migration).toContain("old_value jsonb");
    expect(migration).toContain("new_value jsonb");
    expect(migration).toContain("correlation_id uuid NOT NULL");
  });

  test("rejects silent audit alteration at the database boundary", () => {
    expect(migration).toContain("audit_events_reject_update BEFORE UPDATE");
    expect(migration).toContain("audit_events_reject_delete BEFORE DELETE");
    expect(migration).toContain("audit_events are append-only");
  });

  test("enforces tenant-scoped outbox idempotency and tenant read isolation", () => {
    expect(migration).toContain(
      "CONSTRAINT outbox_events_team_idempotency_key_unique UNIQUE (team_id, idempotency_key)",
    );
    expect(migration).toContain("ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("private.get_teams_for_authenticated_user()");
  });

  test("records atomic delivery intent fields and permitted lifecycle", () => {
    expect(migration).toContain("CREATE TABLE outbox_events");
    expect(migration).toContain("payload jsonb NOT NULL");
    expect(migration).toContain("status IN ('pending', 'processing', 'processed', 'failed')");
  });
});
