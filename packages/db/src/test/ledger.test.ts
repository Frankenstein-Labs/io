import { describe, expect, test } from "bun:test";
import { validateLedgerLines } from "../utils/ledger";

describe("ledger validation", () => {
  test("accepts balanced exact-decimal lines", () => expect(() => validateLedgerLines([
    { accountId: "a", currency: "USD", debit: "10.10", credit: "0" },
    { accountId: "b", currency: "USD", debit: "0", credit: "10.10" },
  ])).not.toThrow());
  test("rejects unbalanced and mixed-currency totals", () => {
    expect(() => validateLedgerLines([{ accountId: "a", currency: "USD", debit: "10", credit: "0" }, { accountId: "b", currency: "USD", debit: "0", credit: "9" }])).toThrow();
    expect(() => validateLedgerLines([{ accountId: "a", currency: "USD", debit: "10", credit: "0" }, { accountId: "b", currency: "EUR", debit: "0", credit: "10" }])).toThrow();
  });
});
