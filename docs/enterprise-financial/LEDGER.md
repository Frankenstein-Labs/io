# Ledger
PostgreSQL uses `numeric(24,8)` and deferred balance checks. Drizzle uses exact decimal strings for new monetary columns. The application validator is preflight only; PostgreSQL is authoritative.
