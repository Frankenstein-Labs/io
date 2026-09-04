import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const commandBoundary = readFileSync(
  new URL("../utils/audit-outbox.ts", import.meta.url),
  "utf8",
);

describe("audited outbox command boundary", () => {
  test("claims idempotency before a mutation and skips duplicate mutations", () => {
    const claim = commandBoundary.indexOf("enqueueOutboxEvent(tx, command.outbox)");
    const duplicateReturn = commandBoundary.indexOf("executed: false", claim);
    const mutation = commandBoundary.indexOf("command.mutate(tx)");

    expect(claim).toBeGreaterThan(-1);
    expect(duplicateReturn).toBeGreaterThan(claim);
    expect(mutation).toBeGreaterThan(duplicateReturn);
  });

  test("writes an audit event and causation link only after the mutation", () => {
    const mutation = commandBoundary.indexOf("command.mutate(tx)");
    const audit = commandBoundary.indexOf("createAuditEvent(tx, command.audit)");
    const causation = commandBoundary.indexOf("causationId:");

    expect(audit).toBeGreaterThan(mutation);
    expect(causation).toBeGreaterThan(audit);
  });
});
