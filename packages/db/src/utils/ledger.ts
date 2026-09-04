export type LedgerLineInput = {
  accountId: string;
  currency: string;
  debit: string;
  credit: string;
};

const DECIMAL = /^\d+(?:\.\d{1,8})?$/;

function toScaled(value: string): bigint {
  if (!DECIMAL.test(value)) throw new Error("Ledger amounts must be positive exact decimals");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(8, "0")}`);
}

/** Validates the same per-currency invariant enforced by the deferred DB trigger. */
export function validateLedgerLines(lines: LedgerLineInput[]): void {
  if (lines.length < 2) throw new Error("A journal entry needs at least two lines");
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const line of lines) {
    if (!/^[A-Z]{3}$/.test(line.currency)) throw new Error("Ledger currency must be ISO 4217 uppercase");
    const debit = toScaled(line.debit);
    const credit = toScaled(line.credit);
    if ((debit === 0n) === (credit === 0n)) throw new Error("A line requires exactly one debit or credit");
    const total = totals.get(line.currency) ?? { debit: 0n, credit: 0n };
    total.debit += debit; total.credit += credit; totals.set(line.currency, total);
  }
  for (const [currency, total] of totals) {
    if (total.debit !== total.credit) throw new Error(`Journal entry is unbalanced for ${currency}`);
  }
}
