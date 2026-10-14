-- Module recouvrement: invariants carried by the database itself (rule-recouvrement-state-transitions-logged,
-- rule-recouvrement-decision-journal, rule-recouvrement-policy-immutable, rule-recouvrement-queue-decided-final,
-- rule-recouvrement-dispute-no-delete). Model: `0001_audit_append_only`, TRUNCATE allowed in `*_test` databases only.
CREATE FUNCTION "base"."refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "base"."refuse_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_database() LIKE '%\_test' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "case_state_history_no_update_delete" BEFORE UPDATE OR DELETE ON "base"."case_state_history"
  FOR EACH ROW EXECUTE FUNCTION "base"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "case_state_history_no_truncate" BEFORE TRUNCATE ON "base"."case_state_history"
  FOR EACH STATEMENT EXECUTE FUNCTION "base"."refuse_truncate"();
--> statement-breakpoint
CREATE TRIGGER "decisions_no_update_delete" BEFORE UPDATE OR DELETE ON "base"."decisions"
  FOR EACH ROW EXECUTE FUNCTION "base"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "decisions_no_truncate" BEFORE TRUNCATE ON "base"."decisions"
  FOR EACH STATEMENT EXECUTE FUNCTION "base"."refuse_truncate"();
--> statement-breakpoint
-- A version of the policy: only its status (imported -> active -> superseded) and the activation author and instant
-- change; never deleted.
CREATE FUNCTION "base"."policy_versions_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a version of the policy is never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.label IS DISTINCT FROM OLD.label
    OR NEW.version_date IS DISTINCT FROM OLD.version_date
    OR NEW.file_hash IS DISTINCT FROM OLD.file_hash
    OR NEW.document IS DISTINCT FROM OLD.document
    OR NEW.imported_by IS DISTINCT FROM OLD.imported_by
    OR NEW.imported_at IS DISTINCT FROM OLD.imported_at
    OR NEW.checks_passed IS DISTINCT FROM OLD.checks_passed THEN
    RAISE EXCEPTION 'the content of a version of the policy never changes' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
    AND NOT ((OLD.status = 'imported' AND NEW.status = 'active') OR (OLD.status = 'active' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'a version of the policy goes from imported to active, then to superseded' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status
    AND (NEW.activated_by IS DISTINCT FROM OLD.activated_by OR NEW.activated_at IS DISTINCT FROM OLD.activated_at) THEN
    RAISE EXCEPTION 'the activation of a version of the policy is written once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "policy_versions_immutable" BEFORE UPDATE OR DELETE ON "base"."policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "base"."policy_versions_guard"();
--> statement-breakpoint
CREATE TRIGGER "policy_versions_no_truncate" BEFORE TRUNCATE ON "base"."policy_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION "base"."refuse_truncate"();
--> statement-breakpoint
-- A decided item of the queue does not change any more.
CREATE FUNCTION "base"."queue_items_decided_final"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'decided' THEN
    RAISE EXCEPTION 'a decided item of the queue does not change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "queue_items_decided_final" BEFORE UPDATE ON "base"."queue_items"
  FOR EACH ROW EXECUTE FUNCTION "base"."queue_items_decided_final"();
--> statement-breakpoint
-- A closed dispute does not change any more; a dispute is never deleted.
CREATE FUNCTION "base"."disputes_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a dispute is never deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'a closed dispute does not change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "disputes_guard" BEFORE UPDATE OR DELETE ON "base"."disputes"
  FOR EACH ROW EXECUTE FUNCTION "base"."disputes_guard"();
