-- Non-destructive additions. Apply after 0001; wrangler tracks applied migrations.
ALTER TABLE user ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE auth_throttle (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_ts INTEGER NOT NULL
);
CREATE INDEX idx_auth_throttle_reset ON auth_throttle(reset_ts);
CREATE TABLE r2_deletion_queue (
  object_key TEXT PRIMARY KEY,
  created_ts INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX idx_memo_owner_state_created ON memo(creator_id, row_status, created_ts DESC, id DESC);
-- Do not move an attachment from one memo to another by accident or in a race.
CREATE TRIGGER attachment_no_implicit_reparent
BEFORE UPDATE OF memo_id ON attachment
WHEN OLD.memo_id IS NOT NULL AND NEW.memo_id IS NOT NULL AND OLD.memo_id != NEW.memo_id
BEGIN
  SELECT RAISE(ABORT, 'attachment is already bound to another memo');
END;
