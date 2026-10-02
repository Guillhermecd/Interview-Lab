import { readFile } from 'node:fs/promises';
import type { ClientBase } from 'pg';

const SEED_FILE = new URL('../../db/seed.sql', import.meta.url);

export async function seedDemoData(client: ClientBase): Promise<void> {
  const seedSql = await readFile(SEED_FILE, 'utf8');
  await client.query(seedSql);
}
