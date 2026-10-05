import { Client, type ClientConfig } from 'pg';
import { loadDatabaseEnv, type DatabaseEnv } from './database-env.js';
import { migrateDown, migrateUp } from './migrate.js';
import { promoteAdmin } from './promote-admin.js';
import { provisionRolePasswords } from './provision-roles.js';
import { seedDemoData } from './seed.js';

const COMMANDS = [
  'migrate',
  'migrate:down',
  'provision',
  'seed',
  'setup',
  'promote-admin',
] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(value: string | undefined): value is Command {
  return COMMANDS.some((command) => command === value);
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function adminConnection(env: DatabaseEnv): ClientConfig {
  return {
    host: env.host,
    port: env.port,
    database: env.name,
    user: env.adminUser,
    password: env.adminPassword,
  };
}

async function withAdminClient(
  connection: ClientConfig,
  action: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client(connection);
  await client.connect();
  try {
    await action(client);
  } finally {
    await client.end();
  }
}

async function run(command: Command, env: DatabaseEnv, argument?: string): Promise<void> {
  const connection = adminConnection(env);
  const provision = () =>
    withAdminClient(connection, (client) => provisionRolePasswords(client, env));
  const seed = () => withAdminClient(connection, seedDemoData);

  switch (command) {
    case 'migrate':
      await migrateUp({ connection, log });
      break;
    case 'migrate:down':
      await migrateDown({ connection, log });
      break;
    case 'provision':
      await provision();
      break;
    case 'seed':
      await seed();
      break;
    case 'setup':
      await migrateUp({ connection, log });
      await provision();
      await seed();
      break;
    case 'promote-admin':
      if (argument === undefined || argument.trim() === '') {
        throw new Error('Usage: promote-admin <email of an existing account>');
      }
      await withAdminClient(connection, async (client) => {
        log(`${await promoteAdmin(client, argument)} is now an administrator of the registry.`);
      });
      break;
  }
  log(`Database command "${command}" finished.`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!isCommand(command)) {
    throw new Error(`Unknown database command. Use one of: ${COMMANDS.join(', ')}`);
  }
  await run(command, loadDatabaseEnv(process.env), process.argv[3]);
}

await main();
