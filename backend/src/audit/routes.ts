import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { authenticate, authenticateMedia, type AuthContext } from '../v2/auth';
import { ConnectError, invalidArgument, notFound, permissionDenied, unauthenticated } from '../v2/connect';
import { detectedType, uploadLimit } from '../media';
import { readLimitedBody } from '../security';
import { businessDate, identifier, KINDS, logStatement, occurredAt, SEVERITIES, sha256, text, timezone, validDate } from './core';

type Ctx = Context<{ Bindings: Env }>;
interface RecordRow {
  id: number; uid: string; incident_uid: string; target_uid: string | null; kind: string;
  title: string; service: string; severity: string; content: string;
  occurred_at: number; occurred_date: string; recorded_at: number; recorded_date: string; timezone: string;
  actor_id: number; actor_username: string; actor_display_name: string; request_id: string; request_hash: string;
  is_void?: number;
}
interface UploadRow {
  uid: string; actor_id: number; created_at: number; filename: string; type: string; size: number; sha256: string; object_key: string;
}
const requireAuth = async (c: Ctx): Promise<AuthContext> => {
  const auth = await authenticate(c.req.raw, c.env);
  if (!auth) throw unauthenticated('请先登录');
  return auth;
};
const requireAdmin = (auth: AuthContext) => {
  if (auth.role !== 'ADMIN') throw permissionDenied('仅管理员可以执行此操作');
};
const fileApi = (row: UploadRow) => ({
  id: row.uid, filename: row.filename, type: row.type, size: row.size, sha256: row.sha256,
  url: `/api/audit/files/${row.uid}/${encodeURIComponent(row.filename)}`,
});
const getRecord = async (env: Env, uid: string) => env.DB.prepare('SELECT * FROM audit_record WHERE uid = ?').bind(uid).first<RecordRow>();
async function recordsApi(env: Env, rows: RecordRow[], snapshot: number) {
  if (!rows.length) return [];
  const placeholders = rows.map(() => '?').join(',');
  const files = await env.DB.prepare(`SELECT u.*, e.record_uid FROM audit_upload u JOIN audit_evidence e ON e.upload_uid = u.uid WHERE e.record_uid IN (${placeholders}) ORDER BY u.created_at, u.uid`)
    .bind(...rows.map(row => row.uid)).all<UploadRow & { record_uid: string }>();
  const voids = await env.DB.prepare(`SELECT DISTINCT target_uid FROM audit_record WHERE kind = 'VOID' AND id <= ? AND target_uid IN (${placeholders})`)
    .bind(snapshot, ...rows.map(row => row.uid)).all<{ target_uid: string }>();
  const voidIds = new Set(voids.results.map(row => row.target_uid));
  return rows.map(row => ({
    id: row.uid, sequence: row.id, incidentId: row.incident_uid, targetId: row.target_uid,
    kind: row.kind, title: row.title, service: row.service, severity: row.severity, content: row.content,
    occurredAt: new Date(row.occurred_at).toISOString(), occurredDate: row.occurred_date,
    recordedAt: new Date(row.recorded_at).toISOString(), recordedDate: row.recorded_date, timezone: row.timezone,
    actor: { id: row.actor_id, username: row.actor_username, displayName: row.actor_display_name },
    voided: voidIds.has(row.uid), attachments: files.results.filter(file => file.record_uid === row.uid).map(fileApi),
  }));
}
function cursor(value: string | undefined, name: string): number {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw invalidArgument(`${name}不正确`);
  return Number(value);
}
async function listRecords(c: Ctx, auth: AuthContext, exporting = false) {
  const q = c.req.query();
  const after = cursor(q.after, '分页游标');
  const snapshot = q.until === undefined
    ? (await c.env.DB.prepare('SELECT COALESCE(MAX(id),0) AS n FROM audit_record').first<{ n: number }>())!.n
    : cursor(q.until, '快照上限');
  const where = ['r.id > ?', 'r.id <= ?'];
  const values: (string | number)[] = [after, snapshot];
  const dateField = q.dateField || 'recorded';
  if (!['recorded', 'occurred'].includes(dateField)) throw invalidArgument('日期维度不正确');
  if (q.all !== undefined && q.all !== '1') throw invalidArgument('all 只接受 1');
  const date = q.date ?? ((q.incident || q.all === '1') ? '' : businessDate(Date.now(), timezone(c.env)));
  if (date) {
    if (!validDate(date)) throw invalidArgument('日期格式应为 YYYY-MM-DD');
    where.push(`r.${dateField === 'recorded' ? 'recorded_date' : 'occurred_date'} = ?`); values.push(date);
  } else if (!q.incident && q.all !== '1') throw invalidArgument('请指定日期或明确查询全部日期');
  if (q.incident) { where.push('r.incident_uid = ?'); values.push(identifier(q.incident, '事故编号')); }
  for (const [key, column, choices] of [
    ['kind', 'kind', KINDS], ['severity', 'severity', SEVERITIES],
  ] as const) {
    if (q[key]) {
      if (!(choices as readonly string[]).includes(q[key])) throw invalidArgument(`${key}不正确`);
      where.push(`r.${column} = ?`); values.push(q[key]);
    }
  }
  for (const [key, column] of [['service', 'service'], ['actor', 'actor_username']] as const) {
    if (q[key]) { where.push(`r.${column} = ?`); values.push(text(q[key], key, 120)); }
  }
  if (q.q) {
    const needle = text(q.q, '关键词', 200);
    where.push(`(instr(lower(r.title || char(10) || r.content || char(10) || r.service || char(10) || r.actor_username || char(10) || r.actor_display_name || char(10) || r.incident_uid), lower(?)) > 0
      OR EXISTS (SELECT 1 FROM audit_evidence e JOIN audit_upload u ON e.upload_uid = u.uid WHERE e.record_uid = r.uid AND instr(lower(u.filename), lower(?)) > 0))`);
    values.push(needle, needle);
  }
  const result = await c.env.DB.prepare(`SELECT r.* FROM audit_record r WHERE ${where.join(' AND ')} ORDER BY r.id LIMIT 51`)
    .bind(...values).all<RecordRow>();
  const page = result.results.slice(0, 50);
  if (exporting && after === 0) {
    await logStatement(c.env, auth, 'EXPORT_RECORDS', 'records', { snapshot, date, dateField, incident: q.incident || '', kind: q.kind || '', service: q.service || '', actor: q.actor || '', severity: q.severity || '', keyword: q.q || '' }).run();
  }
  return c.json({ schemaVersion: 'ywdj-1', items: await recordsApi(c.env, page, snapshot), snapshotMaxId: snapshot,
    nextCursor: result.results.length > 50 ? String(page[page.length - 1].id) : '', timezone: timezone(c.env) });
}
async function jsonBody(c: Ctx): Promise<Record<string, unknown>> {
  if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) throw invalidArgument('需要 application/json');
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(await readLimitedBody(c.req.raw, 160 * 1024))); }
  catch (error) { if (error instanceof ConnectError) throw error; throw invalidArgument('JSON 格式错误'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidArgument('请求必须是 JSON 对象');
  return body as Record<string, unknown>;
}

export function mountAuditRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/audit/meta', async c => {
    const auth = await requireAuth(c);
    const now = Date.now(), zone = timezone(c.env);
    return c.json({ edition: 'ywdj', serverTime: new Date(now).toISOString(), today: businessDate(now, zone), timezone: zone,
      kinds: KINDS, severities: SEVERITIES, uploadLimitBytes: uploadLimit(c.env), scope: 'single-team',
      user: { id: auth.userId, username: auth.username, role: auth.role } });
  });
  app.get('/api/audit/records', async c => listRecords(c, await requireAuth(c)));
  app.get('/api/audit/export', async c => listRecords(c, await requireAuth(c), true));
  app.get('/api/audit/records/:uid', async c => {
    await requireAuth(c);
    const row = await getRecord(c.env, identifier(c.req.param('uid'), '记录编号'));
    if (!row) throw notFound('记录不存在');
    return c.json((await recordsApi(c.env, [row], Number.MAX_SAFE_INTEGER))[0]);
  });
  app.on(['PATCH', 'PUT', 'DELETE'], '/api/audit/records/:uid', async c => {
    const auth = await requireAuth(c);
    await logStatement(c.env, auth, 'BLOCK_RECORD_MUTATION', c.req.param('uid').slice(0, 80), { method: c.req.method }, 'DENIED').run();
    throw permissionDenied('正式记录已锁定，管理员也不能修改或删除；请新增更正或作废说明');
  });
  app.post('/api/audit/records', async c => {
    const auth = await requireAuth(c);
    const body = await jsonBody(c);
    const allowed = new Set(['requestId', 'kind', 'title', 'service', 'severity', 'content', 'occurredAt', 'incidentId', 'targetId', 'attachmentIds']);
    for (const key of Object.keys(body)) if (!allowed.has(key)) throw invalidArgument(`不接受字段 ${key}；登记时间与登记人由服务器生成`);
    const requestId = identifier(body.requestId, '请求编号');
    const kind = text(body.kind, '记录类型', 20);
    if (!(KINDS as readonly string[]).includes(kind)) throw invalidArgument('记录类型不正确');
    if (kind === 'VOID' && auth.role !== 'ADMIN') {
      await logStatement(c.env, auth, 'BLOCK_VOID', typeof body.targetId === 'string' ? body.targetId.slice(0,80) : '', {}, 'DENIED').run();
      throw permissionDenied('普通用户可追加更正；作废标记需要管理员填写原因');
    }
    const input = {
      kind, title: text(body.title, '标题', 160), service: text(body.service, '所属系统', 120, true),
      severity: text(body.severity ?? 'WARNING', '严重程度', 20), content: text(body.content, '正文或更正原因', 32768),
      occurredAt: body.occurredAt ?? '', incidentId: identifier(body.incidentId, '事故编号', true), targetId: identifier(body.targetId, '关联记录编号', true),
      attachmentIds: body.attachmentIds ?? [],
    };
    if (!(SEVERITIES as readonly string[]).includes(input.severity)) throw invalidArgument('严重程度不正确');
    if (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > 20) throw invalidArgument('每条记录最多 20 个附件');
    const fileIds = input.attachmentIds.map(id => identifier(id, '附件编号'));
    if (new Set(fileIds).size !== fileIds.length) throw invalidArgument('附件不能重复');
    input.attachmentIds = fileIds;
    const hash = await sha256(JSON.stringify(input));
    const retry = async () => {
      const row = await c.env.DB.prepare('SELECT * FROM audit_record WHERE actor_id = ? AND request_id = ?').bind(auth.userId, requestId).first<RecordRow>();
      if (!row) return null;
      if (row.request_hash !== hash) throw new ConnectError('already_exists', '同一请求编号对应不同内容；请核实上一条是否已提交');
      return row;
    };
    // Resolve retries BEFORE checking today's date: a lost response retried after midnight must not duplicate a record.
    const existing = await retry();
    if (existing) return c.json((await recordsApi(c.env, [existing], Number.MAX_SAFE_INTEGER))[0]);
    const now = Date.now(), zone = timezone(c.env), date = businessDate(now, zone);
    const eventTime = occurredAt(input.occurredAt, now, zone);
    const uid = `YW-${date.replace(/-/g, '')}-${crypto.randomUUID()}`;
    let incident = uid, service = input.service;
    if (input.incidentId) {
      const root = await getRecord(c.env, input.incidentId);
      if (!root || root.uid !== root.incident_uid) throw invalidArgument('请选择真实存在的事故主记录');
      incident = root.uid;
      if (service && service !== root.service) throw invalidArgument('追加记录的系统必须与原事故一致');
      service = root.service;
    } else {
      if (!['ALERT', 'INCIDENT', 'ACTION'].includes(kind)) throw invalidArgument('此类型必须关联已有事故；首次登记请选择告警、事故初报或操作记录');
      if (!service) throw invalidArgument('首次登记必须填写所属系统');
    }
    if (kind === 'CORRECTION' || kind === 'VOID') {
      if (!input.targetId) throw invalidArgument('更正或作废必须指定原记录，并在正文说明原因');
    } else if (input.targetId) throw invalidArgument('只有更正或作废记录可以指定更正对象');
    if (input.targetId) {
      const target = await getRecord(c.env, input.targetId);
      if (!target || target.incident_uid !== incident) throw invalidArgument('原记录不存在或不属于此事故');
    }
    const actor = await c.env.DB.prepare('SELECT nickname FROM user WHERE id = ?').bind(auth.userId).first<{ nickname: string }>();
    const statements = [c.env.DB.prepare(`INSERT INTO audit_record
      (uid,incident_uid,target_uid,kind,title,service,severity,content,occurred_at,occurred_date,recorded_at,recorded_date,timezone,actor_id,actor_username,actor_display_name,request_id,request_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(uid, incident, input.targetId || null, kind, input.title, service, input.severity, input.content,
        eventTime, businessDate(eventTime, zone), now, date, zone, auth.userId, auth.username, actor?.nickname || auth.username, requestId, hash)];
    for (const fileId of fileIds) {
      // Scalar SELECT => NOT NULL failure if missing/foreign; unique upload_uid prevents reparenting even in races.
      statements.push(c.env.DB.prepare(`INSERT INTO audit_evidence(record_uid, upload_uid) VALUES (?,
        (SELECT uid FROM audit_upload WHERE uid = ? AND actor_id = ?))`).bind(uid, fileId, auth.userId));
    }
    statements.push(logStatement(c.env, auth, kind === 'VOID' ? 'VOID_RECORD' : incident === uid ? 'CREATE_RECORD' : 'APPEND_RECORD', uid,
      { incidentId: incident, targetId: input.targetId || null, kind, attachmentCount: fileIds.length, requestId }));
    try { await c.env.DB.batch(statements); }
    catch (error) {
      const winner = await retry();
      if (winner) return c.json((await recordsApi(c.env, [winner], Number.MAX_SAFE_INTEGER))[0]);
      if (/constraint/i.test(String(error))) throw new ConnectError('already_exists', '附件已被使用、被移除或不属于你；本次登记未保存，请检查附件后重新提交');
      throw error;
    }
    const saved = await getRecord(c.env, uid);
    if (!saved) throw new ConnectError('internal', '提交后读取失败，请用相同请求编号重试');
    return c.json((await recordsApi(c.env, [saved], Number.MAX_SAFE_INTEGER))[0], 201);
  });

  app.post('/api/audit/uploads', async c => {
    const auth = await requireAuth(c);
    if (!c.env.R2) throw new ConnectError('failed_precondition', '需要绑定私有 R2');
    const uid = identifier(c.req.header('X-Upload-ID'), '上传编号');
    const rawName = text(c.req.query('filename'), '文件名', 180);
    const filename = rawName.replace(/[\\/\x00-\x1f\x7f]/g, '_');
    const bytes = await readLimitedBody(c.req.raw, uploadLimit(c.env));
    if (!bytes.length) throw invalidArgument('文件不能为空');
    const type = detectedType(bytes), hash = await sha256(bytes);
    const lookup = () => c.env.DB.prepare('SELECT * FROM audit_upload WHERE uid = ?').bind(uid).first<UploadRow>();
    const identical = (row: UploadRow) => row.actor_id === auth.userId && row.sha256 === hash && row.filename === filename;
    const old = await lookup();
    if (old) { if (identical(old)) return c.json(fileApi(old)); throw new ConnectError('already_exists', '上传编号已被其他文件使用'); }
    const key = `audit/${auth.userId}/${uid}/${crypto.randomUUID()}`;
    await c.env.R2.put(key, bytes as unknown as ArrayBuffer, { httpMetadata: { contentType: type } });
    try {
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO audit_upload(uid,actor_id,created_at,filename,type,size,sha256,object_key) VALUES (?,?,?,?,?,?,?,?)')
          .bind(uid, auth.userId, Date.now(), filename, type, bytes.length, hash, key),
        logStatement(c.env, auth, 'UPLOAD_EVIDENCE', uid, { filename, size: bytes.length, sha256: hash }),
      ]);
    } catch (error) {
      // Each attempt writes a unique R2 key; losing retries never delete the winner's evidence.
      await c.env.DB.prepare('INSERT OR IGNORE INTO r2_deletion_queue(object_key) VALUES (?)').bind(key).run();
      try { await c.env.R2.delete(key); await c.env.DB.prepare('DELETE FROM r2_deletion_queue WHERE object_key = ?').bind(key).run(); }
      catch { console.error('Audit upload compensation queued'); }
      const winner = await lookup();
      if (winner && identical(winner)) return c.json(fileApi(winner));
      if (winner) throw new ConnectError('already_exists', '上传编号已被其他文件使用');
      throw error;
    }
    return c.json(fileApi((await lookup())!), 201);
  });
  app.delete('/api/audit/uploads/:uid', async c => {
    const auth = await requireAuth(c), uid = identifier(c.req.param('uid'), '附件编号');
    const file = await c.env.DB.prepare('SELECT * FROM audit_upload WHERE uid = ? AND actor_id = ?').bind(uid, auth.userId).first<UploadRow>();
    if (!file) throw notFound('草稿附件不存在或不属于你');
    const bound = await c.env.DB.prepare('SELECT 1 AS n FROM audit_evidence WHERE upload_uid = ?').bind(uid).first();
    if (bound) {
      await logStatement(c.env, auth, 'BLOCK_EVIDENCE_DELETE', uid, {}, 'DENIED').run();
      throw permissionDenied('正式记录的附件已锁定，不能删除');
    }
    const result = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT OR IGNORE INTO r2_deletion_queue(object_key)
        SELECT object_key FROM audit_upload WHERE uid = ? AND actor_id = ? AND NOT EXISTS (SELECT 1 FROM audit_evidence WHERE upload_uid = ?)`)
        .bind(uid, auth.userId, uid),
      c.env.DB.prepare('DELETE FROM audit_upload WHERE uid = ? AND actor_id = ? AND NOT EXISTS (SELECT 1 FROM audit_evidence WHERE upload_uid = ?)')
        .bind(uid, auth.userId, uid),
    ]);
    if (result[1].meta.changes !== 1) throw new ConnectError('already_exists', '附件状态已变化，未删除');
    await logStatement(c.env, auth, 'DELETE_DRAFT_UPLOAD', uid).run();
    // Reuse the persistent compensation queue. A later cleanup can finish a failed R2 deletion.
    if (c.env.R2) {
      try { await c.env.R2.delete(file.object_key); await c.env.DB.prepare('DELETE FROM r2_deletion_queue WHERE object_key = ?').bind(file.object_key).run(); }
      catch { console.error('Draft evidence deletion queued'); }
    }
    return c.json({ deleted: true });
  });
  app.on(['GET', 'HEAD'], '/api/audit/files/:uid/:filename', async c => {
    // Image elements use the existing HttpOnly refresh-cookie authentication path.
    if (c.req.header('Sec-Fetch-Site') === 'cross-site') throw permissionDenied('不允许跨站读取附件');
    const auth = await authenticateMedia(c.req.raw, c.env);
    if (!auth) throw unauthenticated('请先登录');
    const row = await c.env.DB.prepare(`SELECT u.*, e.record_uid FROM audit_upload u LEFT JOIN audit_evidence e ON e.upload_uid = u.uid WHERE u.uid = ?`)
      .bind(identifier(c.req.param('uid'), '附件编号')).first<UploadRow & { record_uid: string | null }>();
    if (!row || (!row.record_uid && row.actor_id !== auth.userId)) throw notFound('附件不存在');
    const object = await c.env.R2?.get(row.object_key);
    if (!object) throw notFound('原文件不存在');
    const inline = /^image\/(png|jpeg|gif|webp|avif)$/.test(row.type);
    return new Response(c.req.method === 'HEAD' ? null : object.body, { headers: {
      'Content-Type': inline ? row.type : 'application/octet-stream', 'Content-Length': String(object.size),
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/'/g, '%27')}`,
    } });
  });
  app.get('/api/audit/logs', async c => {
    const auth = await requireAuth(c); requireAdmin(auth);
    const query = c.req.query(), after = cursor(query.after, '分页游标');
    const snapshot = query.until === undefined
      ? (await c.env.DB.prepare('SELECT COALESCE(MAX(id),0) AS n FROM audit_log').first<{ n: number }>())!.n : cursor(query.until, '快照上限');
    const where = ['id > ?', 'id <= ?'], values: (string | number)[] = [after, snapshot];
    if (query.target) { where.push('target = ?'); values.push(text(query.target, '目标', 200)); }
    const rows = await c.env.DB.prepare(`SELECT id, created_at, actor_username, action, target, outcome, details FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id LIMIT 51`)
      .bind(...values).all<{ id: number; created_at: number; actor_username: string; action: string; target: string; outcome: string; details: string }>();
    return c.json({ items: rows.results.slice(0, 50).map(row => ({ ...row, createdAt: new Date(row.created_at).toISOString(), details: JSON.parse(row.details) })),
      snapshotMaxId: snapshot, nextCursor: rows.results.length > 50 ? String(rows.results[49].id) : '' });
  });
}
