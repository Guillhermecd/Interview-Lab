import { escapeIdentifier, escapeLiteral, type ClientBase } from 'pg';
import { APP_ROLE, CATALOG_ROLE, READONLY_ROLE } from './roles.js';

export interface RolePasswords {
  readonlyPassword: string;
  appPassword: string;
  catalogPassword: string;
}

// ALTER ROLE does not accept bind parameters, so the values are escaped by the driver.
async function setRolePassword(client: ClientBase, role: string, password: string): Promise<void> {
  await client.query(`ALTER ROLE ${escapeIdentifier(role)} PASSWORD ${escapeLiteral(password)}`);
}

// Passwords come from the environment, never from versioned migration files.
export async function provisionRolePasswords(
  client: ClientBase,
  passwords: RolePasswords,
): Promise<void> {
  await setRolePassword(client, READONLY_ROLE, passwords.readonlyPassword);
  await setRolePassword(client, APP_ROLE, passwords.appPassword);
  await setRolePassword(client, CATALOG_ROLE, passwords.catalogPassword);
}
