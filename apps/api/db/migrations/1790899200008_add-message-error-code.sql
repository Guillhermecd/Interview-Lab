-- Up Migration

-- The stable code of the failure behind an error message (QUERY_REJECTED,
-- QUERY_TIMEOUT...). The list of conversations uses it to say why the last
-- answer needs attention; older error messages keep it null.
ALTER TABLE app.messages
  ADD COLUMN error_code text,
  ADD CONSTRAINT messages_error_code_only_on_errors
    CHECK (error_code IS NULL OR status = 'error');

-- Down Migration

ALTER TABLE app.messages
  DROP CONSTRAINT messages_error_code_only_on_errors,
  DROP COLUMN error_code;
