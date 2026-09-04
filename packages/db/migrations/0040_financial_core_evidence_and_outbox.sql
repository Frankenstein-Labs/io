-- Additive enterprise-finance foundations. Existing operational tables remain authoritative.

ALTER TABLE outbox_events
  ADD COLUMN worker_id text,
  ADD COLUMN processing_started_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz;
ALTER TABLE outbox_events DROP CONSTRAINT outbox_events_status_check;
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_status_check
  CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'dead_letter'));
CREATE INDEX outbox_events_reclaim_idx
  ON outbox_events (status, processing_started_at)
  WHERE status = 'processing';

-- Atomically claims pending work or a lease abandoned by a crashed worker.
CREATE OR REPLACE FUNCTION private.claim_outbox_events(
  p_worker_id text,
  p_limit integer DEFAULT 20,
  p_lease_seconds integer DEFAULT 300
) RETURNS SETOF outbox_events LANGUAGE sql AS $$
  WITH candidates AS (
    SELECT id FROM outbox_events
    WHERE (status = 'pending' AND available_at <= now())
       OR (status = 'processing' AND processing_started_at < now() - make_interval(secs => p_lease_seconds))
    ORDER BY available_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 100))
  )
  UPDATE outbox_events AS event
  SET status = 'processing', worker_id = p_worker_id,
      processing_started_at = now(), attempts = event.attempts + 1,
      last_error = NULL
  FROM candidates
  WHERE event.id = candidates.id
  RETURNING event.*;
$$;

CREATE TABLE financial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  command_id text NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  event_type text NOT NULL,
  amount numeric(24,8),
  currency text,
  source text NOT NULL,
  audit_event_id uuid REFERENCES audit_events(id) ON DELETE RESTRICT,
  evidence_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_events_amount_currency_check CHECK (
    (amount IS NULL AND currency IS NULL) OR (amount IS NOT NULL AND currency ~ '^[A-Z]{3}$')
  ),
  CONSTRAINT financial_events_team_command_unique UNIQUE (team_id, command_id)
);
CREATE INDEX financial_events_tenant_entity_idx ON financial_events (team_id, entity_type, entity_id, created_at);

CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  currency text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, code)
);
CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','voided')),
  source_type text NOT NULL,
  source_id text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  financial_event_id uuid REFERENCES financial_events(id) ON DELETE RESTRICT,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, idempotency_key)
);
CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  debit numeric(24,8) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(24,8) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX journal_entries_tenant_created_idx ON journal_entries (team_id, created_at);
CREATE INDEX journal_lines_entry_idx ON journal_lines (entry_id);

CREATE OR REPLACE FUNCTION private.assert_posted_journal_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_uuid uuid;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    entry_uuid := COALESCE(NEW.id, OLD.id);
  ELSE
    entry_uuid := COALESCE(NEW.entry_id, OLD.entry_id);
  END IF;
  IF EXISTS (
    SELECT 1 FROM journal_entries entry
    JOIN journal_lines line ON line.entry_id = entry.id
    WHERE entry.id = entry_uuid AND entry.status = 'posted'
    GROUP BY line.currency
    HAVING sum(line.debit) <> sum(line.credit)
  ) OR (
    EXISTS (SELECT 1 FROM journal_entries WHERE id = entry_uuid AND status = 'posted')
    AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE entry_id = entry_uuid)
  ) THEN RAISE EXCEPTION 'posted journal entry must balance debits and credits by currency'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER journal_entry_balance_on_entry
AFTER INSERT OR UPDATE ON journal_entries DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.assert_posted_journal_balanced();
CREATE CONSTRAINT TRIGGER journal_entry_balance_on_line
AFTER INSERT OR UPDATE OR DELETE ON journal_lines DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.assert_posted_journal_balanced();
CREATE OR REPLACE FUNCTION private.reject_immutable_financial_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME; END;
$$;
CREATE TRIGGER financial_events_reject_update BEFORE UPDATE ON financial_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_immutable_financial_mutation();
CREATE TRIGGER financial_events_reject_delete BEFORE DELETE ON financial_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_immutable_financial_mutation();
CREATE TRIGGER journal_lines_reject_update BEFORE UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION private.reject_immutable_financial_mutation();
CREATE TRIGGER journal_lines_reject_delete BEFORE DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION private.reject_immutable_financial_mutation();
CREATE OR REPLACE FUNCTION private.allow_journal_posting_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status IN ('posted', 'voided')
     AND NEW.team_id = OLD.team_id AND NEW.idempotency_key = OLD.idempotency_key
     AND NEW.source_type = OLD.source_type AND NEW.source_id = OLD.source_id
     AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
     AND NEW.correlation_id = OLD.correlation_id
     AND NEW.causation_id IS NOT DISTINCT FROM OLD.causation_id
     AND NEW.financial_event_id IS NOT DISTINCT FROM OLD.financial_event_id
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'journal entries are immutable except for a draft posting transition';
END;
$$;
CREATE TRIGGER journal_entries_reject_update BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION private.allow_journal_posting_transition();
CREATE TRIGGER journal_entries_reject_delete BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION private.reject_immutable_financial_mutation();

CREATE TABLE evidence_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  operation_id text,
  document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  provenance text NOT NULL,
  previous_artifact_id uuid REFERENCES evidence_artifacts(id) ON DELETE RESTRICT,
  audit_event_id uuid REFERENCES audit_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, sha256),
  UNIQUE (team_id, entity_type, entity_id, version)
);
ALTER TABLE financial_events ADD CONSTRAINT financial_events_evidence_id_fkey
  FOREIGN KEY (evidence_id) REFERENCES evidence_artifacts(id) ON DELETE RESTRICT;
CREATE TABLE evidence_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES evidence_artifacts(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('view','download','export')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','finance','accountant','approver','auditor','manager','employee','procurement','treasury','read_only')),
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id, role)
);
CREATE TABLE segregation_of_duties_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  action_a text NOT NULL,
  action_b text NOT NULL,
  enforcement text NOT NULL DEFAULT 'observe' CHECK (enforcement IN ('observe','enforce')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, action_a, action_b)
);

ALTER TABLE financial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE segregation_of_duties_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_events_team_read ON financial_events FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
CREATE POLICY ledger_accounts_team_read ON ledger_accounts FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
CREATE POLICY journal_entries_team_read ON journal_entries FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
CREATE POLICY journal_lines_team_read ON journal_lines FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
CREATE POLICY evidence_artifacts_team_read ON evidence_artifacts FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
CREATE POLICY evidence_access_logs_team_read ON evidence_access_logs FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
CREATE POLICY team_role_assignments_team_read ON team_role_assignments FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
CREATE POLICY segregation_of_duties_policies_team_read ON segregation_of_duties_policies FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
