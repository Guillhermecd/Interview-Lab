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
    `SELECT CASE WHEN p.category IN ('Eletrônicos', 'Móveis') THEN 'duráveis' ELSE 'consumo' END AS grupo,
            avg(i.quantity * i.unit_price) AS ticket_medio
     FROM order_items i JOIN products p ON p.id = i.product_id
     GROUP BY 1 HAVING count(*) > 10`,
  ],
  [
    'search with ILIKE and BETWEEN',
    `SELECT name, price FROM products
     WHERE name ILIKE '%livro%' AND price BETWEEN 10 AND 200 ORDER BY price DESC LIMIT 20`,
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
];
