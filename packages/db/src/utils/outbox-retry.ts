export const OUTBOX_MAX_ATTEMPTS = 8;

/**
 * Bounded exponential backoff with a deterministic cap. Jitter belongs at the
 * worker boundary so a retry can be reproduced from its persisted attempt count.
 */
export function getOutboxRetryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Outbox attempt must be a positive integer");
  }

  return Math.min(1_000 * 2 ** (attempt - 1), 15 * 60 * 1_000);
}

export function getOutboxFailureTransition(
  attempts: number,
  maxAttempts = OUTBOX_MAX_ATTEMPTS,
): { status: "pending"; delayMs: number } | { status: "dead_letter" } {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("Outbox maxAttempts must be a positive integer");
  }

  if (attempts >= maxAttempts) return { status: "dead_letter" };
  return { status: "pending", delayMs: getOutboxRetryDelayMs(attempts) };
}
