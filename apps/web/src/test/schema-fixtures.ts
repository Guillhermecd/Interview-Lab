import type { SchemaOverview } from '@interview-lab/shared';

// A cut of what `GET /api/schema` answers: enough tables to show keys, a
// nullable column and a table the answers under test do not read.
export const SCHEMA: SchemaOverview = {
  tables: [
    {
      name: 'customers',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        { name: 'name', type: 'text', nullable: false, primaryKey: false },
        {
          name: 'region_id',
          type: 'bigint',
          nullable: false,
          primaryKey: false,
          references: { table: 'regions', column: 'id' },
        },
      ],
    },
    {
      name: 'orders',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        {
          name: 'customer_id',
          type: 'bigint',
          nullable: false,
          primaryKey: false,
          references: { table: 'customers', column: 'id' },
        },
        {
          name: 'delivered_at',
          type: 'timestamp with time zone',
          nullable: true,
          primaryKey: false,
        },
      ],
    },
    {
      name: 'regions',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        { name: 'name', type: 'text', nullable: false, primaryKey: false },
      ],
    },
  ],
};
