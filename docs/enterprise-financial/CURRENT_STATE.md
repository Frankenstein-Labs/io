# Current state
Last inspected commit: `a02f598`. Manual transaction creation is a protected tRPC mutation that calls `createTransaction` and then schedules enrichment/matching jobs. It is not yet a financial command. Phase 4 SQL foundations and Phase 5 Drizzle types exist; no real Postgres service is available for integration validation.
