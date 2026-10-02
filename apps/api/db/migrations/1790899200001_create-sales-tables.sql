-- Up Migration

CREATE TABLE sales.regions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE sales.products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  category text NOT NULL,
  price numeric(12, 2) NOT NULL CHECK (price > 0)
);

CREATE TABLE sales.customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  region_id bigint NOT NULL REFERENCES sales.regions (id),
  created_at timestamptz NOT NULL
);

CREATE TABLE sales.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES sales.customers (id),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')),
  ordered_at timestamptz NOT NULL
);

CREATE TABLE sales.order_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES sales.orders (id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES sales.products (id),
  quantity integer NOT NULL CHECK (quantity > 0),
  -- Price at the time of the order; products.price may change later.
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price > 0),
  UNIQUE (order_id, product_id)
);

CREATE INDEX customers_region_id_idx ON sales.customers (region_id);
CREATE INDEX orders_customer_id_idx ON sales.orders (customer_id);
CREATE INDEX orders_ordered_at_idx ON sales.orders (ordered_at);
CREATE INDEX order_items_product_id_idx ON sales.order_items (product_id);

-- Explicit allowlist: only these tables are exposed to the read-only role.
GRANT SELECT ON
  sales.regions,
  sales.products,
  sales.customers,
  sales.orders,
  sales.order_items
TO app_readonly;

-- Down Migration

DROP TABLE sales.order_items;
DROP TABLE sales.orders;
DROP TABLE sales.customers;
DROP TABLE sales.products;
DROP TABLE sales.regions;
