-- Up Migration

-- Application data: lives in `app`, reachable by app_rw and invisible to
-- app_readonly. Conversations have no owner until authentication exists (D-28).
CREATE TABLE app.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  -- Summary of the messages up to summarized_through_message_id (D-27).
  summary text,
  summarized_through_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES app.conversations (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  -- The question, or the assistant's explanation / refusal / error message.
  -- Rows returned by a query are never stored.
  content text NOT NULL,
  status text CHECK (status IN ('answered', 'not_answerable', 'error')),
  sql text,
  visualization jsonb,
  row_count integer,
  attempts integer,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Only assistant messages carry a status.
  CHECK ((role = 'assistant') = (status IS NOT NULL))
);

CREATE INDEX messages_conversation_id_idx ON app.messages (conversation_id, id);
CREATE INDEX conversations_updated_at_idx ON app.conversations (updated_at DESC);

-- Down Migration

DROP TABLE app.messages;
DROP TABLE app.conversations;
