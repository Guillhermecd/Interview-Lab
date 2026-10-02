-- Up Migration

-- Large objects need no table privilege: by default any role can call
-- lo_create/lo_from_bytea and write to the database. Nothing in this project
-- uses them, so EXECUTE is removed from PUBLIC.
-- lo_import/lo_export are skipped: PostgreSQL already restricts them to superusers.
DO $$
DECLARE
  large_object_function regprocedure;
BEGIN
  FOR large_object_function IN
    SELECT oid::regprocedure
    FROM pg_proc
    WHERE pronamespace = 'pg_catalog'::regnamespace
      AND (proname LIKE 'lo\_%' OR proname IN ('loread', 'lowrite'))
      AND proname NOT IN ('lo_import', 'lo_export')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', large_object_function);
  END LOOP;
END
$$;

-- Down Migration

DO $$
DECLARE
  large_object_function regprocedure;
BEGIN
  FOR large_object_function IN
    SELECT oid::regprocedure
    FROM pg_proc
    WHERE pronamespace = 'pg_catalog'::regnamespace
      AND (proname LIKE 'lo\_%' OR proname IN ('loread', 'lowrite'))
      AND proname NOT IN ('lo_import', 'lo_export')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', large_object_function);
  END LOOP;
END
$$;
