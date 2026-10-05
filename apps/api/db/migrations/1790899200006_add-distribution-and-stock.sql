-- Up Migration

-- Distribution centers, stock and delivery dates for the operations dashboard
-- (D-50). Everything lives in `sales`, exposed read-only like the other tables.

CREATE TABLE sales.distribution_centers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  city text NOT NULL,
  state char(2) NOT NULL,
  region_id bigint NOT NULL REFERENCES sales.regions (id)
);

-- The new NOT NULL columns have no meaningful value for the rows that exist,
-- which are demonstration data: they are wiped here and reloaded by the seed.
-- Nothing in the `app` schema (users, conversations, usage) is touched.
TRUNCATE sales.order_items, sales.orders, sales.customers, sales.products, sales.regions
  RESTART IDENTITY CASCADE;

ALTER TABLE sales.products
  ADD COLUMN sku text NOT NULL UNIQUE,
  -- How the product is counted: bag, bar, roll, pair or unit.
  ADD COLUMN unit text NOT NULL CHECK (unit IN ('sc', 'br', 'rl', 'pr', 'un')),
  ADD COLUMN cost numeric(12, 2) NOT NULL CHECK (cost > 0),
  -- Archived products stay in the history of orders and stock, out of new use.
  ADD COLUMN active boolean NOT NULL DEFAULT true;

ALTER TABLE sales.orders
  -- The center that ships the order; its region is the region of the sale (D-52).
  ADD COLUMN distribution_center_id bigint NOT NULL REFERENCES sales.distribution_centers (id),
  ADD COLUMN expected_delivery_at timestamptz NOT NULL,
  -- Null until the order is delivered.
  ADD COLUMN delivered_at timestamptz,
  ADD CONSTRAINT orders_expected_after_order CHECK (expected_delivery_at >= ordered_at),
  ADD CONSTRAINT orders_delivered_after_order CHECK (delivered_at >= ordered_at);

-- Every change of stock, never edited: the balance in stock_levels is the sum
-- of these rows. Quantities are positive; only an adjustment carries a sign.
CREATE TABLE sales.stock_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  moved_at timestamptz NOT NULL,
  type text NOT NULL CHECK (type IN ('inbound', 'outbound', 'transfer', 'adjustment')),
  product_id bigint NOT NULL REFERENCES sales.products (id),
  -- Where the stock enters or leaves; the origin of a transfer.
  distribution_center_id bigint NOT NULL REFERENCES sales.distribution_centers (id),
  destination_center_id bigint REFERENCES sales.distribution_centers (id),
  quantity integer NOT NULL,
  responsible_name text NOT NULL,
  -- Invoice, order or reason behind the movement.
  document text NOT NULL,
  CONSTRAINT stock_movements_quantity_sign
    CHECK (quantity <> 0 AND (type = 'adjustment' OR quantity > 0)),
  CONSTRAINT stock_movements_destination CHECK (
    (type = 'transfer'
      AND destination_center_id IS NOT NULL
      AND destination_center_id <> distribution_center_id)
    OR (type <> 'transfer' AND destination_center_id IS NULL)
  )
);

CREATE TABLE sales.stock_levels (
  distribution_center_id bigint NOT NULL REFERENCES sales.distribution_centers (id),
  product_id bigint NOT NULL REFERENCES sales.products (id),
  quantity integer NOT NULL CHECK (quantity >= 0),
  minimum_quantity integer NOT NULL CHECK (minimum_quantity >= 0),
  PRIMARY KEY (distribution_center_id, product_id)
);

CREATE INDEX distribution_centers_region_id_idx ON sales.distribution_centers (region_id);
CREATE INDEX orders_distribution_center_id_idx ON sales.orders (distribution_center_id);
CREATE INDEX orders_delivered_at_idx ON sales.orders (delivered_at);
CREATE INDEX stock_levels_product_id_idx ON sales.stock_levels (product_id);
CREATE INDEX stock_movements_moved_at_idx ON sales.stock_movements (moved_at);
CREATE INDEX stock_movements_center_product_idx
  ON sales.stock_movements (distribution_center_id, product_id, moved_at);
CREATE INDEX stock_movements_destination_idx
  ON sales.stock_movements (destination_center_id)
  WHERE destination_center_id IS NOT NULL;

-- Explicit allowlist, as in the first migration.
GRANT SELECT ON
  sales.distribution_centers,
  sales.stock_levels,
  sales.stock_movements
TO app_readonly;

-- Down Migration

DROP TABLE sales.stock_levels;
DROP TABLE sales.stock_movements;

ALTER TABLE sales.orders
  DROP COLUMN distribution_center_id,
  DROP COLUMN expected_delivery_at,
  DROP COLUMN delivered_at;

ALTER TABLE sales.products
  DROP COLUMN sku,
  DROP COLUMN unit,
  DROP COLUMN cost,
  DROP COLUMN active;

DROP TABLE sales.distribution_centers;
