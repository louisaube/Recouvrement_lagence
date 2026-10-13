-- rule-recouvrement-agent-user-role: the database refuses an agent profile on an account whose role is not `user`,
-- and the passage to `admin` of an account that carries the agent profile (no column of the data contract changes).
CREATE FUNCTION "base"."user_profiles_agent_needs_user_role"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.profile = 'agent' AND (SELECT role FROM base.users WHERE id = NEW.user_id) <> 'user' THEN
    RAISE EXCEPTION 'an agent profile requires an account with the user role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "user_profiles_agent_role" BEFORE INSERT OR UPDATE ON "base"."user_profiles"
  FOR EACH ROW EXECUTE FUNCTION "base"."user_profiles_agent_needs_user_role"();
--> statement-breakpoint
CREATE FUNCTION "base"."users_agent_stays_user"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'admin' AND EXISTS (SELECT 1 FROM base.user_profiles WHERE user_id = NEW.id AND profile = 'agent') THEN
    RAISE EXCEPTION 'an account with the agent profile cannot become an administrator' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "users_agent_stays_user" BEFORE UPDATE OF role ON "base"."users"
  FOR EACH ROW EXECUTE FUNCTION "base"."users_agent_stays_user"();
