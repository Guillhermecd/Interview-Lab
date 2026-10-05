-- Demonstration data for the `sales` schema: "Rota Materiais", a distributor of
-- building materials (D-51). Idempotent: wipes and reloads.
-- Dates are relative to now(), so "last quarter" questions always have data.
-- Volume: 5 regions, 9 distribution centers, 200 products, 500 customers,
-- 20,000 orders over 24 months, and the stock movements behind every balance.

TRUNCATE
  sales.stock_levels,
  sales.stock_movements,
  sales.order_items,
  sales.orders,
  sales.customers,
  sales.products,
  sales.distribution_centers,
  sales.regions
  RESTART IDENTITY;

-- Fixed seed: every run produces the same distribution.
SELECT setseed(0.42);

INSERT INTO sales.regions (name)
VALUES ('Norte'), ('Nordeste'), ('Centro-Oeste'), ('Sudeste'), ('Sul');

INSERT INTO sales.distribution_centers (name, city, state, region_id)
SELECT center.name, center.city, center.state, regions.id
FROM (
  VALUES
    ('CD Campinas', 'Campinas', 'SP', 'Sudeste'),
    ('CD Guarulhos', 'Guarulhos', 'SP', 'Sudeste'),
    ('CD Contagem', 'Contagem', 'MG', 'Sudeste'),
    ('CD Curitiba', 'Curitiba', 'PR', 'Sul'),
    ('CD Duque de Caxias', 'Duque de Caxias', 'RJ', 'Sudeste'),
    ('CD Recife', 'Recife', 'PE', 'Nordeste'),
    ('CD Goiânia', 'Goiânia', 'GO', 'Centro-Oeste'),
    ('CD Manaus', 'Manaus', 'AM', 'Norte'),
    ('CD Serra', 'Serra', 'ES', 'Sudeste')
) AS center (name, city, state, region)
JOIN sales.regions AS regions ON regions.name = center.region
-- The order above is the size of each center, used below to spread the orders.
ORDER BY array_position(
  ARRAY['CD Campinas', 'CD Guarulhos', 'CD Contagem', 'CD Curitiba', 'CD Duque de Caxias',
        'CD Recife', 'CD Goiânia', 'CD Manaus', 'CD Serra'],
  center.name
);

-- 40 product lines, each in 5 presentations. The first presentation of the
-- first lines of each category are the best sellers: products are inserted
-- from the most to the least popular, and orders favor the low ids.
WITH lines (number, category, line, unit, base_price, presentations) AS (
  VALUES
    (1, 'Cimento e argamassa', 'Cimento CP-II-E-32', 'sc', 38, ARRAY['50 kg', '40 kg', '25 kg', '50 kg paletizado', '1 kg']),
    (2, 'Cimento e argamassa', 'Argamassa AC-III', 'sc', 42, ARRAY['20 kg', '15 kg', '5 kg', '20 kg branca', '20 kg cinza']),
    (3, 'Cimento e argamassa', 'Cimento CP-V ARI', 'sc', 44, ARRAY['50 kg', '40 kg', '25 kg', '50 kg paletizado', '1 kg']),
    (4, 'Cimento e argamassa', 'Argamassa AC-II', 'sc', 28, ARRAY['20 kg', '15 kg', '5 kg', '20 kg branca', '20 kg cinza']),
    (5, 'Cimento e argamassa', 'Cal hidratada CH-III', 'sc', 17, ARRAY['20 kg', '15 kg', '8 kg', '20 kg paletizada', '5 kg']),
    (6, 'Cimento e argamassa', 'Rejunte flexível', 'un', 14, ARRAY['1 kg branco', '1 kg cinza', '1 kg bege', '5 kg branco', '5 kg cinza']),
    (7, 'Cimento e argamassa', 'Graute estrutural', 'sc', 52, ARRAY['25 kg', '20 kg', '5 kg', '25 kg fluido', '25 kg rápido']),
    (8, 'Cimento e argamassa', 'Argamassa de reboco', 'sc', 19, ARRAY['20 kg', '25 kg', '40 kg', '20 kg fina', '20 kg grossa']),
    (9, 'Aço e metais', 'Vergalhão CA-50', 'br', 46, ARRAY['10 mm', '8 mm', '12,5 mm', '16 mm', '20 mm']),
    (10, 'Aço e metais', 'Chapa aço galvanizado', 'un', 210, ARRAY['0,65 mm', '0,50 mm', '0,95 mm', '1,25 mm', '2,00 mm']),
    (11, 'Aço e metais', 'Arame recozido', 'rl', 21, ARRAY['18 BWG', '16 BWG', '14 BWG', '12 BWG', '10 BWG']),
    (12, 'Aço e metais', 'Tela soldada', 'un', 185, ARRAY['Q92', 'Q61', 'Q138', 'Q196', 'Q283']),
    (13, 'Aço e metais', 'Vergalhão CA-60', 'br', 27, ARRAY['5 mm', '4,2 mm', '6 mm', '7 mm', '8 mm']),
    (14, 'Aço e metais', 'Perfil U enrijecido', 'br', 148, ARRAY['100 mm', '75 mm', '127 mm', '150 mm', '200 mm']),
    (15, 'Aço e metais', 'Cantoneira de aço', 'br', 74, ARRAY['1" x 1/8"', '1.1/2" x 1/8"', '2" x 3/16"', '2.1/2" x 1/4"', '3" x 1/4"']),
    (16, 'Aço e metais', 'Prego com cabeça', 'un', 16, ARRAY['17 x 27 1 kg', '15 x 15 1 kg', '18 x 30 1 kg', '19 x 36 1 kg', '22 x 48 1 kg']),
    (17, 'Tubos e conexões', 'Tubo PVC esgoto', 'br', 62, ARRAY['100 mm 6 m', '40 mm 6 m', '50 mm 6 m', '75 mm 6 m', '150 mm 6 m']),
    (18, 'Tubos e conexões', 'Telha fibrocimento', 'un', 58, ARRAY['2,44 m', '1,22 m', '1,53 m', '1,83 m', '3,05 m']),
    (19, 'Tubos e conexões', 'Tubo PVC soldável', 'br', 34, ARRAY['25 mm 6 m', '20 mm 6 m', '32 mm 6 m', '40 mm 6 m', '50 mm 6 m']),
    (20, 'Tubos e conexões', 'Joelho 90° soldável', 'un', 3, ARRAY['25 mm', '20 mm', '32 mm', '40 mm', '50 mm']),
    (21, 'Tubos e conexões', 'Caixa d''água polietileno', 'un', 420, ARRAY['1.000 L', '310 L', '500 L', '2.000 L', '5.000 L']),
    (22, 'Tubos e conexões', 'Registro de esfera', 'un', 29, ARRAY['25 mm', '20 mm', '32 mm', '40 mm', '50 mm']),
    (23, 'Tubos e conexões', 'Tubo CPVC água quente', 'br', 88, ARRAY['22 mm 3 m', '15 mm 3 m', '28 mm 3 m', '35 mm 3 m', '42 mm 3 m']),
    (24, 'Tubos e conexões', 'Luva de correr PVC', 'un', 9, ARRAY['100 mm', '40 mm', '50 mm', '75 mm', '150 mm']),
    (25, 'Elétrica e cabos', 'Cabo flexível', 'rl', 265, ARRAY['2,5 mm 100 m', '1,5 mm 100 m', '4 mm 100 m', '6 mm 100 m', '10 mm 100 m']),
    (26, 'Elétrica e cabos', 'Disjuntor bipolar', 'un', 64, ARRAY['40 A', '20 A', '32 A', '50 A', '63 A']),
    (27, 'Elétrica e cabos', 'Eletroduto corrugado', 'rl', 72, ARRAY['25 mm 50 m', '20 mm 50 m', '32 mm 25 m', '40 mm 25 m', '50 mm 25 m']),
    (28, 'Elétrica e cabos', 'Disjuntor monopolar', 'un', 18, ARRAY['20 A', '10 A', '16 A', '25 A', '32 A']),
    (29, 'Elétrica e cabos', 'Tomada 2P+T', 'un', 12, ARRAY['10 A', '20 A', '10 A dupla', '20 A dupla', '10 A com USB']),
    (30, 'Elétrica e cabos', 'Quadro de distribuição', 'un', 96, ARRAY['12 disjuntores', '6 disjuntores', '18 disjuntores', '24 disjuntores', '36 disjuntores']),
    (31, 'Elétrica e cabos', 'Cabo PP', 'rl', 310, ARRAY['3 x 2,5 mm 100 m', '2 x 1,5 mm 100 m', '2 x 2,5 mm 100 m', '3 x 1,5 mm 100 m', '3 x 4 mm 100 m']),
    (32, 'Elétrica e cabos', 'Lâmpada LED bulbo', 'un', 11, ARRAY['9 W', '7 W', '12 W', '15 W', '20 W']),
    (33, 'EPIs', 'Bota de segurança PVC', 'pr', 49, ARRAY['', 'cano longo', 'branca', 'com biqueira', 'forrada']),
    (34, 'EPIs', 'Luva nitrílica (par)', 'pr', 9, ARRAY['', 'tamanho P', 'tamanho M', 'tamanho G', 'cano longo']),
    (35, 'EPIs', 'Capacete de segurança', 'un', 24, ARRAY['aba frontal', 'aba total', 'com jugular', 'com carneira', 'classe B']),
    (36, 'EPIs', 'Óculos de proteção', 'un', 8, ARRAY['incolor', 'fumê', 'amarelo', 'ampla visão', 'sobrepor']),
    (37, 'EPIs', 'Protetor auricular', 'un', 3, ARRAY['plug silicone', 'espuma', 'tipo concha', 'com cordão', 'haste']),
    (38, 'EPIs', 'Cinto paraquedista', 'un', 189, ARRAY['1 ponto', '2 pontos', '3 pontos', '4 pontos', '5 pontos']),
    (39, 'EPIs', 'Respirador PFF2', 'un', 4, ARRAY['sem válvula', 'com válvula', 'dobrável', 'concha', 'carvão ativado']),
    (40, 'EPIs', 'Luva de vaqueta', 'pr', 21, ARRAY['punho curto', 'punho longo', 'mista', 'com reforço', 'cano 20 cm'])
),
numbered AS (
  SELECT
    lines.*,
    row_number() OVER (PARTITION BY lines.category ORDER BY lines.number) AS line_rank
  FROM lines
),
catalog AS (
  SELECT
    numbered.category,
    trim(numbered.line || ' ' || presentation.label) AS name,
    numbered.unit,
    -- The first presentation carries the list price of the line.
    round((numbered.base_price * (CASE presentation.position WHEN 1 THEN 1 ELSE 0.6 + random() * 0.9 END))::numeric, 2)
      AS price,
    -- Best sellers first: presentation, then the position of the line in its category.
    (presentation.position - 1) * 40 + (numbered.line_rank - 1) * 5 + random() * 5 AS popularity
  FROM numbered
  CROSS JOIN LATERAL unnest(numbered.presentations) WITH ORDINALITY AS presentation (label, position)
)
INSERT INTO sales.products (name, category, price, sku, unit, cost)
SELECT
  catalog.name,
  catalog.category,
  catalog.price,
  'RM-' || lpad((row_number() OVER (ORDER BY catalog.popularity))::text, 4, '0'),
  catalog.unit,
  greatest(round((catalog.price * (0.55 + random() * 0.25))::numeric, 2), 0.01)
FROM catalog
ORDER BY catalog.popularity;

INSERT INTO sales.customers (name, region_id, created_at)
SELECT
  (ARRAY['Construtora', 'Engenharia', 'Incorporadora', 'Empreiteira', 'Depósito', 'Materiais',
         'Metalúrgica', 'Instaladora'])[1 + floor(random() * 8)::int]
    || ' '
    || (ARRAY['Horizonte', 'Alicerce', 'Edificar', 'Paraná', 'Ipatinga', 'Serra Azul', 'Vale Verde',
              'Bandeirantes', 'Atlântica', 'Planalto', 'Litoral', 'Araucária', 'Sertão', 'Tocantins',
              'Pioneira', 'Capital', 'União', 'Fortaleza', 'Mantiqueira', 'Pantanal'])
       [1 + floor(random() * 20)::int]
    || ' ' || lpad(customer.number::text, 3, '0'),
  1 + floor(random() * 5)::int,
  now() - random() * interval '1095 days'
FROM generate_series(1, 500) AS customer (number);

-- Orders: bigger centers ship more. An order is delivered only once its lead
-- time has passed; about 92% of the deliveries are on time, fewer in the
-- centers farther down the list.
WITH draws AS (
  SELECT
    1 + floor(random() * 500)::int AS customer_id,
    (ARRAY[1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 8, 8, 9])
      [1 + floor(random() * 27)::int] AS distribution_center_id,
    now() - random() * interval '730 days' AS ordered_at,
    (3 + floor(random() * 8)::int) * interval '1 day' AS lead_time,
    random() AS status_draw,
    random() AS late_draw,
    random() AS delay_draw
  FROM generate_series(1, 20000)
),
dated AS (
  SELECT
    draws.*,
    draws.ordered_at + draws.lead_time AS expected_delivery_at,
    CASE
      WHEN draws.late_draw < 0.04 + draws.distribution_center_id * 0.008
        THEN draws.lead_time + (0.2 + draws.delay_draw * 6) * interval '1 day'
      ELSE draws.lead_time - draws.delay_draw * interval '2 days'
    END AS delivery_time
  FROM draws
),
decided AS (
  SELECT
    dated.*,
    CASE
      WHEN dated.status_draw < 0.07 THEN 'cancelled'
      WHEN dated.ordered_at + dated.delivery_time <= now() THEN 'delivered'
      WHEN dated.status_draw < 0.30 THEN 'pending'
      WHEN dated.status_draw < 0.55 THEN 'paid'
      ELSE 'shipped'
    END AS status
  FROM dated
)
INSERT INTO sales.orders
  (customer_id, status, ordered_at, distribution_center_id, expected_delivery_at, delivered_at)
SELECT
  decided.customer_id,
  decided.status,
  decided.ordered_at,
  decided.distribution_center_id,
  decided.expected_delivery_at,
  CASE WHEN decided.status = 'delivered' THEN decided.ordered_at + decided.delivery_time END
FROM decided;

-- Three to ten distinct products per order, favoring the best sellers (a few
-- products make most of the revenue, which is what the ABC curve shows).
WITH picks AS (
  SELECT
    orders.id AS order_id,
    1 + floor(200 * power(random(), 4))::int AS product_id,
    1 + floor(random() * 40)::int AS quantity
  FROM sales.orders AS orders
  CROSS JOIN LATERAL generate_series(1, 3 + (orders.id % 8)::int)
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

-- Stock. Every balance is the sum of its movements, so the ledger and
-- stock_levels always agree. Order of the steps: what left (orders, transfers,
-- adjustments), then the purchases sized to leave the balance wanted today.

-- Outbound: what shipped orders took from their center.
INSERT INTO sales.stock_movements
  (moved_at, type, product_id, distribution_center_id, quantity, responsible_name, document)
SELECT
  -- Picked and shipped some hours after the order; for an order placed just
  -- now, halfway between the order and now, so it is never in the future.
  least(
    orders.ordered_at + (2 + (items.product_id + orders.id) % 30) * interval '1 hour',
    orders.ordered_at + (now() - orders.ordered_at) / 2
  ),
  'outbound',
  items.product_id,
  orders.distribution_center_id,
  items.quantity,
  (ARRAY['Juliana Prado', 'Rafael Nogueira', 'Camila Duarte'])[1 + (orders.id % 3)::int],
  'Pedido ' || orders.id
FROM sales.order_items AS items
JOIN sales.orders AS orders ON orders.id = items.order_id
WHERE orders.status IN ('shipped', 'delivered');

-- Transfers between centers.
INSERT INTO sales.stock_movements
  (moved_at, type, product_id, distribution_center_id, destination_center_id, quantity,
   responsible_name, document)
SELECT
  now() - draws.age,
  'transfer',
  draws.product_id,
  draws.origin_id,
  1 + (draws.origin_id - 1 + draws.step) % 9,
  draws.quantity,
  'Patrícia Lemos',
  'TRF ' || (6000 + draws.number)
FROM (
  SELECT
    transfer.number,
    random() * interval '720 days' AS age,
    1 + floor(200 * power(random(), 3))::int AS product_id,
    1 + floor(random() * 9)::int AS origin_id,
    1 + floor(random() * 8)::int AS step,
    20 + floor(random() * 300)::int AS quantity
  FROM generate_series(1, 600) AS transfer (number)
) AS draws;

-- Adjustments: losses and count corrections, mostly negative.
INSERT INTO sales.stock_movements
  (moved_at, type, product_id, distribution_center_id, quantity, responsible_name, document)
SELECT
  now() - random() * interval '720 days',
  'adjustment',
  1 + floor(200 * power(random(), 3))::int,
  1 + floor(random() * 9)::int,
  CASE WHEN random() < 0.8 THEN -(1 + floor(random() * 40)::int) ELSE 1 + floor(random() * 20)::int END,
  'Marcos Vieira',
  (ARRAY['Inventário cíclico', 'Avaria no recebimento', 'Acerto de contagem'])
    [1 + floor(random() * 3)::int]
FROM generate_series(1, 600);

-- For each center and product: the average daily outflow, the minimum stock
-- (15 days of it) and the balance wanted today, in days of coverage. A few
-- pairs are left short on purpose, so the dashboard has alerts to show.
DROP TABLE IF EXISTS seed_stock_plan;
CREATE TEMP TABLE seed_stock_plan AS
WITH outflow AS (
  SELECT
    centers.id AS distribution_center_id,
    products.id AS product_id,
    greatest(
      coalesce(sum(movements.quantity) FILTER (WHERE movements.type = 'outbound'), 0) / 730.0,
      0.2
    ) AS daily
  FROM sales.distribution_centers AS centers
  CROSS JOIN sales.products AS products
  LEFT JOIN sales.stock_movements AS movements
    ON movements.distribution_center_id = centers.id AND movements.product_id = products.id
  GROUP BY centers.id, products.id
),
net AS (
  -- What the movements so far add up to, per center and product.
  SELECT ledger.distribution_center_id, ledger.product_id, sum(ledger.quantity) AS quantity
  FROM (
    SELECT distribution_center_id, product_id,
           CASE type WHEN 'adjustment' THEN quantity ELSE -quantity END AS quantity
    FROM sales.stock_movements
    UNION ALL
    SELECT destination_center_id, product_id, quantity
    FROM sales.stock_movements
    WHERE type = 'transfer'
  ) AS ledger
  GROUP BY ledger.distribution_center_id, ledger.product_id
),
drawn AS (
  SELECT outflow.*, random() AS shortage_draw, random() AS coverage_draw, random() AS opening_draw
  FROM outflow
)
SELECT
  drawn.distribution_center_id,
  drawn.product_id,
  greatest(ceil(drawn.daily * 15)::int, 5) AS minimum_quantity,
  greatest(
    ceil(drawn.daily * (
      CASE
        WHEN drawn.shortage_draw < 0.03 THEN 1 + drawn.coverage_draw * 4
        WHEN drawn.shortage_draw < 0.10 THEN 6 + drawn.coverage_draw * 8
        WHEN drawn.shortage_draw < 0.20 THEN 15 + drawn.coverage_draw * 15
        ELSE 30 + drawn.coverage_draw * 45
      END
    ))::int,
    1
  ) AS wanted,
  coalesce(net.quantity, 0) AS net_before_purchases,
  drawn.opening_draw
FROM drawn
LEFT JOIN net
  ON net.distribution_center_id = drawn.distribution_center_id
 AND net.product_id = drawn.product_id;

-- Inbound: an opening balance two years ago, then one purchase a month. Their
-- total covers everything that left plus the balance wanted today.
INSERT INTO sales.stock_movements
  (moved_at, type, product_id, distribution_center_id, quantity, responsible_name, document)
SELECT
  now() - interval '731 days',
  'inbound',
  plan.product_id,
  plan.distribution_center_id,
  greatest(ceil(plan.wanted * (0.9 + plan.opening_draw * 0.2))::int, 1),
  'Rafael Nogueira',
  'Saldo inicial'
FROM seed_stock_plan AS plan;

INSERT INTO sales.stock_movements
  (moved_at, type, product_id, distribution_center_id, quantity, responsible_name, document)
SELECT
  now() - ((24 - purchase.number) * 30 + 2 + random() * 20) * interval '1 day',
  'inbound',
  plan.product_id,
  plan.distribution_center_id,
  greatest(
    ceil((plan.wanted - plan.net_before_purchases
          - greatest(ceil(plan.wanted * (0.9 + plan.opening_draw * 0.2))::int, 1)) / 24.0)::int,
    1
  ),
  (ARRAY['Rafael Nogueira', 'André Matos'])[1 + (plan.product_id % 2)::int],
  'NF-e ' || (80000 + plan.distribution_center_id * 1000 + plan.product_id + purchase.number * 17)
FROM seed_stock_plan AS plan
CROSS JOIN generate_series(1, 24) AS purchase (number);

-- The balance is whatever the ledger adds up to.
INSERT INTO sales.stock_levels (distribution_center_id, product_id, quantity, minimum_quantity)
SELECT
  plan.distribution_center_id,
  plan.product_id,
  balance.quantity,
  plan.minimum_quantity
FROM seed_stock_plan AS plan
JOIN (
  SELECT ledger.distribution_center_id, ledger.product_id, sum(ledger.quantity) AS quantity
  FROM (
    SELECT distribution_center_id, product_id,
           CASE WHEN type IN ('inbound', 'adjustment') THEN quantity ELSE -quantity END AS quantity
    FROM sales.stock_movements
    UNION ALL
    SELECT destination_center_id, product_id, quantity
    FROM sales.stock_movements
    WHERE type = 'transfer'
  ) AS ledger
  GROUP BY ledger.distribution_center_id, ledger.product_id
) AS balance
  ON balance.distribution_center_id = plan.distribution_center_id
 AND balance.product_id = plan.product_id;

DROP TABLE seed_stock_plan;

ANALYZE sales.regions, sales.distribution_centers, sales.products, sales.customers, sales.orders,
  sales.order_items, sales.stock_movements, sales.stock_levels;
