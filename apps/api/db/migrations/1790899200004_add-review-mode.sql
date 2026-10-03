-- Up Migration

-- Review mode (D-32, D-33): an assistant message can wait for the user to
-- approve or edit its SQL before it runs.
ALTER TABLE app.messages DROP CONSTRAINT messages_status_check;
ALTER TABLE app.messages ADD CONSTRAINT messages_status_check
  CHECK (status IN ('answered', 'not_answerable', 'error', 'pending_review'));

-- Audit of human edits: the SQL written by the LLM is kept next to the one
-- that actually ran, and `edited` says whether the user changed it.
ALTER TABLE app.messages
  ADD COLUMN generated_sql text,
  ADD COLUMN edited boolean;

-- Down Migration

ALTER TABLE app.messages
  DROP COLUMN edited,
  DROP COLUMN generated_sql;

UPDATE app.messages SET status = 'error' WHERE status = 'pending_review';
ALTER TABLE app.messages DROP CONSTRAINT messages_status_check;
ALTER TABLE app.messages ADD CONSTRAINT messages_status_check
  CHECK (status IN ('answered', 'not_answerable', 'error'));
