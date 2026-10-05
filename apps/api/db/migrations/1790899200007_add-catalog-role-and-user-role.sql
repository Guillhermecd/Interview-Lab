-- Up Migration

-- The registry (Phase 09e, D-56): the first path that writes to `sales`. It
-- gets a role of its own, used by one pool of the API, so the chat keeps
-- running only as app_readonly. No password here: `db:provision` sets it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_catalog_rw') THEN
    CREATE ROLE app_catalog_rw LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
END
$$;

ALTER ROLE app_catalog_rw SET statement_timeout = '5s';
ALTER ROLE app_catalog_rw SET search_path = sales;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_catalog_rw', current_database());
END
$$;
GRANT USAGE ON SCHEMA sales TO app_catalog_rw;

-- Exactly what registering products and stock movements needs, table by table.
-- SELECT comes with each write because RETURNING, UPDATE ... WHERE and
-- ON CONFLICT read the row. There is no DELETE anywhere: a product is archived,
-- and a movement is never removed.
GRANT SELECT, INSERT, UPDATE ON sales.products TO app_catalog_rw;
GRANT SELECT, INSERT, UPDATE ON sales.stock_levels TO app_catalog_rw;
GRANT SELECT, INSERT ON sales.stock_movements TO app_catalog_rw;

-- Who may use the registry. Everyone is a viewer until promoted with
-- `db:promote-admin` (D-58): signing up never grants it.
ALTER TABLE app.users
  ADD COLUMN role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'admin'));

-- Down Migration

ALTER TABLE app.users DROP COLUMN role;

REVOKE ALL ON sales.products, sales.stock_levels, sales.stock_movements FROM app_catalog_rw;
REVOKE ALL ON SCHEMA sales FROM app_catalog_rw;
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM app_catalog_rw', current_database());
END
$$;
DROP ROLE app_catalog_rw;
