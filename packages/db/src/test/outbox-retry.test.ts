import { describe, expect, test } from "bun:test";
import {
  getOutboxFailureTransition,
  getOutboxRetryDelayMs,
  OUTBOX_MAX_ATTEMPTS,
} from "../utils/outbox-retry";

describe("outbox retry policy", () => {
  test("uses bounded exponential backoff", () => {
    expect(getOutboxRetryDelayMs(1)).toBe(1_000);
    expect(getOutboxRetryDelayMs(4)).toBe(8_000);
    expect(getOutboxRetryDelayMs(99)).toBe(15 * 60 * 1_000);
  });

  test("retries below the maximum and dead-letters terminal failures", () => {
    expect(getOutboxFailureTransition(1)).toEqual({ status: "pending", delayMs: 1_000 });
    expect(getOutboxFailureTransition(OUTBOX_MAX_ATTEMPTS)).toEqual({
      status: "dead_letter",
    });
  });
});
