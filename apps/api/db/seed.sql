-- Demonstration data for the `sales` schema. Idempotent: wipes and reloads.
-- Dates are relative to now(), so "last quarter" questions always have data.
-- Volume: 5 regions, 40 products, 500 customers, 20,000 orders over 24 months.

TRUNCATE sales.order_items, sales.orders, sales.customers, sales.products, sales.regions
  RESTART IDENTITY;

-- Fixed seed: every run produces the same distribution.
SELECT setseed(0.42);

INSERT INTO sales.regions (name)
VALUES ('Norte'), ('Nordeste'), ('Centro-Oeste'), ('Sudeste'), ('Sul');

INSERT INTO sales.products (name, category, price)
SELECT
  category.name || ' ' || lpad(item.number::text, 2, '0'),
  category.name,
  round((category.base_price * (0.6 + random() * 0.8))::numeric, 2)
FROM (
  VALUES
    ('Eletrônicos', 1800),
    ('Móveis', 950),
    ('Vestuário', 140),
    ('Alimentos', 35),
    ('Livros', 60)
) AS category (name, base_price)
CROSS JOIN generate_series(1, 8) AS item (number);

INSERT INTO sales.customers (name, region_id, created_at)
SELECT
  'Cliente ' || lpad(customer.number::text, 4, '0'),
  1 + floor(random() * 5)::int,
  now() - random() * interval '1095 days'
FROM generate_series(1, 500) AS customer (number);

INSERT INTO sales.orders (customer_id, status, ordered_at)
SELECT
  1 + floor(random() * 500)::int,
  (ARRAY['pending', 'paid', 'shipped', 'delivered', 'delivered', 'delivered', 'cancelled'])
    [1 + floor(random() * 7)::int],
  now() - random() * interval '730 days'
FROM generate_series(1, 20000);

-- One to four distinct products per order.
WITH picks AS (
  SELECT
    orders.id AS order_id,
    1 + floor(random() * 40)::int AS product_id,
    1 + floor(random() * 5)::int AS quantity
  FROM sales.orders AS orders
  CROSS JOIN LATERAL generate_series(1, 1 + (orders.id % 4)::int)
)
INSERT INTO sales.order_items (order_id, product_id, quantity, unit_price)
SELECT DISTINCT ON (picks.order_id, picks.product_id)
  picks.order_id,
  products.id,
  picks.quantity,
  products.price
FROM picks
JOIN sales.products AS products ON products.id = picks.product_id
ORDER BY picks.order_id, picks.product_id;

ANALYZE sales.regions, sales.products, sales.customers, sales.orders, sales.order_items;
