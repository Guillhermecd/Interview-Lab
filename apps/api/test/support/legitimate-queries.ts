// Queries a user could plausibly ask for. The guard must accept every one of
// them (unit test) and PostgreSQL must run them as rewritten (integration test).
export const LEGITIMATE_QUERIES: [description: string, sql: string][] = [
  [
    'revenue by region in the last quarter',
    `SELECT r.name AS regiao, sum(i.quantity * i.unit_price) AS faturamento
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     JOIN regions r ON r.id = c.region_id
     JOIN order_items i ON i.order_id = o.id
     WHERE o.ordered_at >= date_trunc('quarter', now()) - interval '3 months'
       AND o.ordered_at < date_trunc('quarter', now())
       AND o.status <> 'cancelled'
     GROUP BY r.name
     ORDER BY faturamento DESC`,
  ],
  [
    'monthly revenue with a running total',
    `WITH monthly AS (
       SELECT date_trunc('month', o.ordered_at) AS mes, sum(i.quantity * i.unit_price) AS total
       FROM orders o JOIN order_items i ON i.order_id = o.id
       GROUP BY 1
     )
     SELECT mes, total, sum(total) OVER (ORDER BY mes) AS acumulado FROM monthly ORDER BY mes`,
  ],
  [
    'top products by category',
    `SELECT * FROM (
       SELECT p.category, p.name, sum(i.quantity) AS unidades,
              rank() OVER (PARTITION BY p.category ORDER BY sum(i.quantity) DESC) AS posicao
       FROM order_items i JOIN products p ON p.id = i.product_id
       GROUP BY p.category, p.name
     ) ranked WHERE posicao <= 3`,
  ],
  [
    'customers without orders',
    `SELECT c.name FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.id
     WHERE o.id IS NULL ORDER BY c.name LIMIT 100`,
  ],
  [
    'order status share',
    `SELECT status, count(*) AS pedidos,
            round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS percentual
     FROM orders GROUP BY status ORDER BY pedidos DESC`,
  ],
  [
    'conditional aggregation',
    `SELECT r.name,
            count(*) FILTER (WHERE o.status = 'delivered') AS entregues,
            count(*) FILTER (WHERE o.status = 'cancelled') AS cancelados
     FROM orders o JOIN customers c ON c.id = o.customer_id JOIN regions r ON r.id = c.region_id
     GROUP BY r.name`,
  ],
  [
    'average ticket with CASE and IN',
    `SELECT CASE WHEN p.category IN ('Aço e metais', 'Tubos e conexões') THEN 'estrutura' ELSE 'acabamento' END AS grupo,
            avg(i.quantity * i.unit_price) AS ticket_medio
     FROM order_items i JOIN products p ON p.id = i.product_id
     GROUP BY 1 HAVING count(*) > 10`,
  ],
  [
    'search with ILIKE and BETWEEN',
    `SELECT name, price FROM products
     WHERE name ILIKE '%cimento%' AND price BETWEEN 10 AND 200 ORDER BY price DESC LIMIT 20`,
  ],
  [
    'distinct with EXISTS',
    `SELECT DISTINCT c.region_id FROM customers c
     WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.ordered_at > now() - interval '30 days')`,
  ],
  [
    'union of two totals',
    `SELECT 'pedidos' AS metrica, count(*) AS valor FROM orders
     UNION ALL
     SELECT 'clientes', count(*) FROM customers`,
  ],
  ['grouping sets', 'SELECT status, count(*) FROM orders GROUP BY ROLLUP (status)'],
  [
    'calendar with generate_series',
    `SELECT g.dia::date, count(o.id)
     FROM generate_series(now() - interval '6 days', now(), interval '1 day') AS g (dia)
     LEFT JOIN orders o ON o.ordered_at::date = g.dia::date
     GROUP BY 1 ORDER BY 1`,
  ],
  [
    'null handling',
    'SELECT coalesce(name, $$sem nome$$) FROM customers WHERE name IS NOT NULL LIMIT 5',
  ],
  ['a row comparison', 'SELECT id FROM orders WHERE (customer_id, status) = (1, $$paid$$) LIMIT 5'],
  [
    'an array comparison',
    "SELECT id FROM orders WHERE status = ANY (ARRAY['paid', 'shipped']) LIMIT 5",
  ],
  [
    'revenue by the region of the distribution center, per category',
    `SELECT r.name AS regiao, p.category, sum(i.quantity * i.unit_price) AS faturamento
     FROM order_items i
     JOIN orders o ON o.id = i.order_id
     JOIN distribution_centers dc ON dc.id = o.distribution_center_id
     JOIN regions r ON r.id = dc.region_id
     JOIN products p ON p.id = i.product_id
     WHERE o.status <> 'cancelled'
     GROUP BY r.name, p.category`,
  ],
  [
    'products below the minimum stock, with days of coverage',
    `WITH consumo AS (
       SELECT product_id, distribution_center_id, sum(quantity) / 30.0 AS saida_media_dia
       FROM stock_movements
       WHERE type = 'outbound' AND moved_at >= now() - interval '30 days'
       GROUP BY 1, 2
     )
     SELECT p.name AS material, dc.name AS centro, s.quantity, s.minimum_quantity,
            floor(s.quantity / nullif(c.saida_media_dia, 0)) AS cobertura_dias
     FROM stock_levels s
     JOIN products p ON p.id = s.product_id
     JOIN distribution_centers dc ON dc.id = s.distribution_center_id
     LEFT JOIN consumo c
       ON c.product_id = s.product_id AND c.distribution_center_id = s.distribution_center_id
     WHERE s.quantity < s.minimum_quantity
     ORDER BY cobertura_dias NULLS LAST`,
  ],
  [
    'stock value by distribution center',
    `SELECT dc.name, round(sum(s.quantity * p.cost), 2) AS valor_estoque
     FROM stock_levels s
     JOIN products p ON p.id = s.product_id
     JOIN distribution_centers dc ON dc.id = s.distribution_center_id
     WHERE p.active
     GROUP BY dc.name ORDER BY valor_estoque DESC`,
  ],
  [
    'deliveries on time by distribution center',
    `SELECT dc.name,
            round(100.0 * count(*) FILTER (WHERE o.delivered_at <= o.expected_delivery_at) / count(*), 1)
              AS no_prazo_pct
     FROM orders o JOIN distribution_centers dc ON dc.id = o.distribution_center_id
     WHERE o.delivered_at IS NOT NULL
     GROUP BY dc.name`,
  ],
  [
    'transfers between distribution centers',
    `SELECT origem.name AS origem, destino.name AS destino, sum(m.quantity) AS quantidade
     FROM stock_movements m
     JOIN distribution_centers origem ON origem.id = m.distribution_center_id
     JOIN distribution_centers destino ON destino.id = m.destination_center_id
     WHERE m.type = 'transfer'
     GROUP BY 1, 2`,
  ],
];
