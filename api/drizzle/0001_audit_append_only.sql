-- rule-foundation-audit-db-append-only: the database itself refuses to change or erase the journal, even for the
-- connection of the application and inside a transaction (SQLSTATE 42501, insufficient_privilege).
-- Known limit: the owner of the table can still drop it or disable the triggers; in deployment the application should
-- connect with a role that only has SELECT and INSERT on base.audit_logs.
CREATE FUNCTION "base"."audit_logs_refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'base.audit_logs is append-only' USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_update_delete" BEFORE UPDATE OR DELETE ON "base"."audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "base"."audit_logs_refuse_change"();
--> statement-breakpoint
-- TRUNCATE is refused too, except in the acceptance database (name ending with `_test`, Q-AUDIT-03), which the
-- harness empties completely between two scenarios.
CREATE FUNCTION "base"."audit_logs_refuse_truncate"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_database() LIKE '%\_test' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'base.audit_logs is append-only' USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_truncate" BEFORE TRUNCATE ON "base"."audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "base"."audit_logs_refuse_truncate"();
