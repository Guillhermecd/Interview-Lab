-- Up Migration

-- Accounts (D-08). The email is stored in lower case; the password only as a
-- scrypt hash.
CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Conversations get an owner. Those created before authentication keep a null
-- owner and are visible to nobody (D-35).
ALTER TABLE app.conversations
  ADD COLUMN owner_id uuid REFERENCES app.users (id) ON DELETE CASCADE;
CREATE INDEX conversations_owner_updated_idx ON app.conversations (owner_id, updated_at DESC);

-- Tokens spent with the LLM, per user and conversation, including calls that
-- belong to no single message (the conversation summary).
CREATE TABLE app.token_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES app.conversations (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('answer', 'review', 'execution', 'summary')),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  -- LLM calls behind this record (an answer is usually two).
  calls integer NOT NULL CHECK (calls > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX token_usage_user_created_idx ON app.token_usage (user_id, created_at);

-- Down Migration

DROP TABLE app.token_usage;
DROP INDEX app.conversations_owner_updated_idx;
ALTER TABLE app.conversations DROP COLUMN owner_id;
DROP TABLE app.users;
