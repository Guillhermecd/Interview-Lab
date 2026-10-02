-- Up Migration

-- Roles are cluster-wide, so creation must tolerate a role left by another database.
-- No password is set here: secrets never live in versioned files. Until
-- `db:provision` sets one from the environment, the roles cannot authenticate.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
END
$$;

-- Session defaults for the read-only role. A session can override both with SET,
-- so they are a safety net: the real boundary is the set of privileges below.
ALTER ROLE app_readonly SET default_transaction_read_only = on;
ALTER ROLE app_readonly SET statement_timeout = '5s';
ALTER ROLE app_readonly SET search_path = sales;
ALTER ROLE app_rw SET search_path = app;

-- Remove what every role inherits through PUBLIC. Without this, GRANT CONNECT
-- below would be meaningless and CREATE TEMP TABLE would work for app_readonly.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_readonly, app_rw', current_database());
END
$$;

-- sales: demonstration data, the only schema app_readonly can reach.
-- app: application data (users, history, tokens), out of app_readonly's reach.
CREATE SCHEMA sales;
CREATE SCHEMA app;

GRANT USAGE ON SCHEMA sales TO app_readonly;
GRANT USAGE ON SCHEMA app TO app_rw;

-- app_rw gets DML on every table later created in `app`. There is deliberately
-- no equivalent for app_readonly: each exposed table is granted explicitly, so
-- a new table is never exposed by accident.
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;

-- Down Migration

ALTER DEFAULT PRIVILEGES IN SCHEMA app
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  REVOKE USAGE, SELECT ON SEQUENCES FROM app_rw;

DROP SCHEMA app CASCADE;
DROP SCHEMA sales CASCADE;

DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM app_readonly, app_rw', current_database());
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO PUBLIC', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO PUBLIC;

DROP ROLE app_rw;
DROP ROLE app_readonly;
