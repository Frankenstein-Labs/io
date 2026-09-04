import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../migrations/0040_financial_core_evidence_and_outbox.sql", import.meta.url),
  "utf8",
);

describe("financial core migration foundations", () => {
  test("claims concurrent outbox work atomically and records terminal failures", () => {
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("'dead_letter'");
    expect(migration).toContain("processing_started_at");
  });

  test("stores a tenant-scoped, balanced, append-only ledger", () => {
    expect(migration).toContain("CREATE TABLE ledger_accounts");
    expect(migration).toContain("CREATE TABLE journal_entries");
    expect(migration).toContain("CREATE TABLE journal_lines");
    expect(migration).toContain("posted journal entry must balance debits and credits by currency");
    expect(migration).toContain("journal_lines_reject_update");
    expect(migration).toContain("journal_entries_reject_update");
  });

  test("versions hash-addressed evidence and preserves tenant reads", () => {
    expect(migration).toContain("CREATE TABLE evidence_artifacts");
    expect(migration).toContain("sha256 ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain("CREATE TABLE evidence_access_logs");
    expect(migration).toContain("evidence_artifacts_team_read");
  });
});
