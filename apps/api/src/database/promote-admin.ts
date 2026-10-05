import type { ClientBase } from 'pg';

export class UnknownAccountError extends Error {
  constructor(email: string) {
    super(`No account with the email "${email}". Create it in the application first.`);
    this.name = 'UnknownAccountError';
  }
}

// Makes an existing account an administrator of the registry (D-58). It runs
// with the admin credentials of the database, from the command line: nothing in
// the API can grant this, so signing up with a chosen email never does.
// Returns the email as stored.
export async function promoteAdmin(client: ClientBase, email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const result = await client.query<{ email: string }>(
    "UPDATE app.users SET role = 'admin' WHERE email = $1 RETURNING email",
    [normalized],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new UnknownAccountError(normalized);
  }
  return row.email;
}
