-- ywdj: additive application audit tables. No database administrator ACL changes.
CREATE TABLE audit_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  incident_uid TEXT NOT NULL REFERENCES audit_record(uid),
  target_uid TEXT REFERENCES audit_record(uid),
  kind TEXT NOT NULL CHECK (kind IN ('ALERT','INCIDENT','ACTION','RECOVERY','REVIEW','CORRECTION','VOID')),
  title TEXT NOT NULL,
  service TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  content TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  occurred_date TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  recorded_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES user(id),
  actor_username TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  UNIQUE(actor_id, request_id)
);
CREATE INDEX idx_audit_record_date ON audit_record(recorded_date, id);
CREATE INDEX idx_audit_record_occurred ON audit_record(occurred_date, id);
CREATE INDEX idx_audit_record_incident ON audit_record(incident_uid, id);
CREATE INDEX idx_audit_record_service ON audit_record(service, recorded_date, id);
CREATE INDEX idx_audit_record_actor ON audit_record(actor_id, recorded_date, id);
CREATE INDEX idx_audit_record_target ON audit_record(target_uid, kind);

CREATE TABLE audit_upload (
  uid TEXT PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  filename TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE
);
CREATE TABLE audit_evidence (
  record_uid TEXT NOT NULL REFERENCES audit_record(uid),
  upload_uid TEXT NOT NULL UNIQUE REFERENCES audit_upload(uid),
  PRIMARY KEY(record_uid, upload_uid)
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  actor_id INTEGER REFERENCES user(id),
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','DENIED')),
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_log_created ON audit_log(created_at, id);
CREATE INDEX idx_audit_log_target ON audit_log(target, id);
-- App title only; preserve existing accounts and content. Do not migrate personal notes silently.
UPDATE system_setting SET value = json_set(value,
  '$.disallowUserRegistration', json('true'),
  '$.customProfile.title', '运维登记',
  '$.customProfile.description', '当天登记 · 提交锁定 · 追加留痕 · 事故溯源')
WHERE name = 'GENERAL';
