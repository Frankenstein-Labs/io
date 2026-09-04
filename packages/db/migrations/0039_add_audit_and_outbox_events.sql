-- Additive, forward-only Phase 1B foundation. `activities` remains untouched.
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type text NOT NULL,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  request_id text,
  source text NOT NULL,
  result text NOT NULL,
  reason text,
  previous_hash text,
  event_hash text,
  signature text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_team_created_at_idx ON audit_events (team_id, created_at);
CREATE INDEX audit_events_correlation_id_idx ON audit_events (correlation_id);
CREATE INDEX audit_events_object_idx ON audit_events (team_id, object_type, object_id);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_team_idempotency_key_unique UNIQUE (team_id, idempotency_key)
);
CREATE INDEX outbox_events_pending_idx ON outbox_events (status, available_at);
CREATE INDEX outbox_events_team_created_at_idx ON outbox_events (team_id, created_at);

-- Prevent normal application roles from changing or deleting audit evidence.
-- Table owners and superusers can still bypass triggers; operational controls are
-- documented in docs/adr/0002-audit-outbox-foundations.md.
CREATE OR REPLACE FUNCTION private.reject_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;
CREATE TRIGGER audit_events_reject_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_audit_event_mutation();
CREATE TRIGGER audit_events_reject_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_audit_event_mutation();

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Audit events can be selected by a member of the team"
  ON audit_events FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
CREATE POLICY "Outbox events can be selected by a member of the team"
  ON outbox_events FOR SELECT TO authenticated
  USING (team_id IN (SELECT private.get_teams_for_authenticated_user()));
