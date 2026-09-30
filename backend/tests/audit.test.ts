import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { businessDate, occurredAt } from '../src/audit/core';

const SECRET = 'audit-test-jwt-not-a-production-secret-836510383';
const SETUP = 'audit-test-setup-not-a-production-secret-836510383';
const PASSWORD = 'audit-local-test-password-819725';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1kAAAAASUVORK5CYII=', 'base64');
let mf: Miniflare, db: any, admin = '', member = '', second = '', cookie = '', root: any, photo: any;
let requestNumber = 0;
async function request(path: string, body?: unknown, token = member, method = body === undefined ? 'GET' : 'POST') {
  const response = await mf.dispatchFetch(`https://audit.test${path}`, { method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `audit-test-${requestNumber++}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() as any, response };
}
const rpc = (service: string, method: string, body: unknown = {}, token = admin) => request(`/memos.api.v1.${service}/${method}`, body, token);
const input = (extra: Record<string,unknown> = {}) => ({ requestId: crypto.randomUUID(), kind: 'INCIDENT', title: '支付接口超时', service: '支付系统', severity: 'CRITICAL', content: '发现连续告警，初步排查中。100% under_score', ...extra });
async function upload(uid = crypto.randomUUID(), token = member, filename = '告警截图.png', bytes = PNG) {
  const response = await mf.dispatchFetch(`https://audit.test/api/audit/uploads?filename=${encodeURIComponent(filename)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'X-Upload-ID': uid, 'Content-Type': 'application/octet-stream' }, body: bytes });
  return { status: response.status, data: await response.json() as any };
}
const create = (body = input(), token = member) => request('/api/audit/records', body, token);

beforeAll(async () => {
  const bundle = await build({ entryPoints:['src/index.ts'], bundle:true, format:'esm', platform:'browser', target:'es2022', write:false });
  mf = new Miniflare(convertV4MiniflareOptions({ workers:[{ name:'audit-test', modules:true, script:bundle.outputFiles[0].text,
    compatibilityDate:'2026-09-01', compatibilityFlags:['nodejs_compat'], d1Databases:{DB:'audit-db'}, r2Buckets:{R2:'audit-bucket'},
    bindings:{JWT_SECRET:SECRET, SETUP_KEY:SETUP, UPLOAD_LIMIT_MB:'1', BASE_URL:'', AUDIT_TIMEZONE:'Asia/Shanghai'} }] }));
  db = await mf.getD1Database('DB');
  for (const file of ['0001_v2.sql','0002_personal.sql','0003_ywdj.sql']) {
    const triggers: string[] = [];
    const sql = readFileSync(`migrations/${file}`,'utf8').replace(/--[^\n]*/g,'').replace(/CREATE TRIGGER[\s\S]*?END;/g,t=>{triggers.push(t);return '';});
    for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
    for (const trigger of triggers) await db.prepare(trigger).run();
  }
  const setup = await mf.dispatchFetch('https://audit.test/memos.api.v1.UserService/CreateUser', { method:'POST',
    headers:{'Content-Type':'application/json','X-Setup-Key':SETUP}, body:JSON.stringify({user:{username:'audit-admin',password:PASSWORD}}) });
  expect(setup.status).toBe(200);
  admin = (await rpc('AuthService','SignIn',{passwordCredentials:{username:'audit-admin',password:PASSWORD}},'')).data.accessToken;
  for (const username of ['operator-one','operator-two']) {
    expect((await rpc('UserService','CreateUser',{user:{username,password:PASSWORD,role:'USER',displayName:username}})).status).toBe(200);
    const result = await rpc('AuthService','SignIn',{passwordCredentials:{username,password:PASSWORD}},'');
    if (username === 'operator-one') { member=result.data.accessToken; cookie=result.response.headers.get('Set-Cookie')!.split(';')[0]; }
    else second=result.data.accessToken;
  }
});
afterAll(async()=>{await mf?.dispose();});

describe('business dates without client-clock trust',()=>{
  it('changes Shanghai business date at UTC 16:00',()=>{
    expect(businessDate(Date.parse('2026-09-30T15:59:59Z'),'Asia/Shanghai')).toBe('2026-09-30');
    expect(businessDate(Date.parse('2026-09-30T16:00:00Z'),'Asia/Shanghai')).toBe('2026-10-01');
  });
  it('rejects yesterday, future dates, future times and malformed timezones',()=>{
    const now=Date.parse('2026-09-30T12:00:00Z');
    for (const value of ['2026-09-29T12:00:00Z','2026-10-01T12:00:00Z','2026-09-30T13:00:00Z','2026-09-30T12:00:00','2026-02-30T12:00:00Z']) {
      expect(()=>occurredAt(value,now,'Asia/Shanghai')).toThrow();
    }
  });
  it('accepts same-day past time and supports a configured DST timezone',()=>{
    const now=Date.parse('2026-09-30T12:00:00Z');
    expect(occurredAt('2026-09-30T08:00:00+08:00',now,'Asia/Shanghai')).toBe(Date.parse('2026-09-30T00:00:00Z'));
    expect(businessDate(Date.parse('2026-11-01T07:30:00Z'),'America/Los_Angeles')).toBe('2026-11-01');
  });
});

describe.sequential('ywdj application audit integration',()=>{
  it('requires login for records, metadata, export and logs',async()=>{
    for(const path of ['/api/audit/meta','/api/audit/records','/api/audit/export','/api/audit/logs']) expect((await request(path,undefined,'')).status).toBe(401);
  });
  it('reports server business date, not a client supplied header',async()=>{
    const result=await request('/api/audit/meta');
    expect(result.data.today).toBe(businessDate(Date.parse(result.data.serverTime),'Asia/Shanghai'));
    expect(result.data.scope).toBe('single-team');
  });
  it('blocks open registration even if an administrator changes legacy settings',async()=>{
    await db.prepare("UPDATE system_setting SET value=json_set(value,'$.disallowUserRegistration',json('false')) WHERE name='GENERAL'").run();
    expect((await rpc('UserService','CreateUser',{user:{username:'intruder',password:PASSWORD}},'')).status).toBe(403);
  });
  it('rejects client supplied date, author, state and public visibility fields',async()=>{
    for(const extra of [{recordedAt:'2000-01-01T00:00:00Z'},{created_ts:1},{actorId:1},{visibility:'PUBLIC'},{state:'ARCHIVED'},{createTime:'2000-01-01T00:00:00Z'}]) {
      expect((await create(input(extra))).status).toBe(400);
    }
  });
  it('rejects backdating, future dating and an empty initial system',async()=>{
    expect((await create(input({occurredAt:new Date(Date.now()-86400000).toISOString()}))).status).toBe(400);
    expect((await create(input({occurredAt:new Date(Date.now()+86400000).toISOString()}))).status).toBe(400);
    expect((await create(input({service:''}))).status).toBe(400);
  });
  it('uploads privately, rejects other users staging access and rejects fake image types',async()=>{
    const result=await upload(); expect(result.status).toBe(201); photo=result.data;
    expect((await mf.dispatchFetch(`https://audit.test${photo.url}`,{headers:{Authorization:`Bearer ${second}`}})).status).toBe(404);
    expect((await mf.dispatchFetch(`https://audit.test${photo.url}`)).status).toBe(401);
    expect((await upload(crypto.randomUUID(),member,'bad.png',Buffer.from('<svg onload="alert(1)"></svg>'))).status).toBe(400);
    expect((await upload(crypto.randomUUID(),member,'huge.png',Buffer.alloc(1024*1024+1))).status).toBe(429);
  });
  it('atomically records server time, user snapshots, evidence and a system log',async()=>{
    const before=Date.now(), result=await create(input({attachmentIds:[photo.id]}));
    expect(result.status,JSON.stringify(result.data)).toBe(201); root=result.data;
    expect(Date.parse(root.recordedAt)).toBeGreaterThanOrEqual(before);
    expect(root.incidentId).toBe(root.id); expect(root.actor.username).toBe('operator-one');
    expect(root.attachments[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE target=? AND action=\'CREATE_RECORD\'').bind(root.id).first()).n).toBe(1);
  });
  it('allows other team members to read records and evidence, never anonymous users',async()=>{
    expect((await request(`/api/audit/records/${root.id}`,undefined,second)).status).toBe(200);
    const response=await mf.dispatchFetch(`https://audit.test${photo.url}`,{headers:{Authorization:`Bearer ${second}`}});
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await mf.dispatchFetch(`https://audit.test${photo.url}`,{headers:{Cookie:cookie}})).status).toBe(200);
  });
  it('blocks edits and deletion for BOTH ordinary users and administrators',async()=>{
    for(const token of [member,admin]) for(const method of ['PATCH','PUT','DELETE']) {
      expect((await request(`/api/audit/records/${root.id}`,{content:'篡改'},token,method)).status).toBe(403);
    }
    expect((await request(`/api/audit/records/${root.id}`)).data.content).toBe(root.content);
  });
  it('blocks legacy create/update/delete/reparent/share and account cascade deletion',async()=>{
    for(const [service,method] of [['MemoService','CreateMemo'],['MemoService','UpdateMemo'],['MemoService','DeleteMemo'],['MemoService','CreateMemoComment'],['MemoService','SetMemoAttachments'],['MemoService','CreateMemoShare'],['AttachmentService','CreateAttachment'],['AttachmentService','DeleteAttachment'],['AttachmentService','BatchDeleteAttachments'],['UserService','DeleteUser']]) {
      expect((await rpc(service,method,{name:root.id},member)).status).toBe(403);
    }
    expect((await request('/api/attachments/upload',{},member)).status).toBe(403);
  });
  it('locks committed evidence even for its uploader and protects R2 bytes',async()=>{
    expect((await request(`/api/audit/uploads/${photo.id}`,undefined,member,'DELETE')).status).toBe(403);
    expect((await create(input({attachmentIds:[photo.id]}))).status).toBe(409);
    const response=await mf.dispatchFetch(`https://audit.test${photo.url}`,{headers:{Cookie:cookie}});
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  });
  it('rejects missing/foreign evidence without leaving a phantom record or success log',async()=>{
    const before=(await db.prepare('SELECT COUNT(*) AS n FROM audit_record').first()).n;
    const foreign=(await upload(crypto.randomUUID(),second)).data;
    for(const attachmentIds of [[crypto.randomUUID()],[foreign.id]]) expect((await create(input({attachmentIds}))).status).toBe(409);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM audit_record').first()).n).toBe(before);
  });
  it('deduplicates concurrent submissions and rejects request-ID reuse with different content',async()=>{
    const body=input(); const results=await Promise.all([create(body),create(body)]);
    expect(results.every(result=>[200,201].includes(result.status)),JSON.stringify(results)).toBe(true);
    expect(results[0].data.id).toBe(results[1].data.id);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM audit_record WHERE request_id=?').bind(body.requestId).first()).n).toBe(1);
    expect((await create({...body,content:'不同内容'})).status).toBe(409);
  });
  it('makes two submissions competing for one upload all-or-nothing',async()=>{
    const file=(await upload()).data;
    const results=await Promise.all([create(input({attachmentIds:[file.id]})),create(input({attachmentIds:[file.id]}))]);
    expect(results.map(r=>r.status).sort()).toEqual([201,409]);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM audit_evidence WHERE upload_uid=?').bind(file.id).first()).n).toBe(1);
  });
  it('permits removal of only the callers unsubmitted staging upload',async()=>{
    const file=(await upload()).data;
    expect((await request(`/api/audit/uploads/${file.id}`,undefined,second,'DELETE')).status).toBe(404);
    expect((await request(`/api/audit/uploads/${file.id}`,undefined,member,'DELETE')).status).toBe(200);
    expect((await mf.dispatchFetch(`https://audit.test${file.url}`,{headers:{Cookie:cookie}})).status).toBe(404);
  });
  it('appends correction without rewriting the original and disallows cross-incident targets',async()=>{
    const correction=await create(input({kind:'CORRECTION',incidentId:root.id,targetId:root.id,content:'更正：当前证据指向连接池配置问题。'}),second);
    expect(correction.status).toBe(201); expect(correction.data.targetId).toBe(root.id);
    expect((await request(`/api/audit/records/${root.id}`)).data.content).toBe(root.content);
    const other=(await create()).data;
    expect((await create(input({kind:'CORRECTION',incidentId:root.id,targetId:other.id}))).status).toBe(400);
  });
  it('supports todays follow-up to an earlier incident and resolves an old retry after midnight',async()=>{
    const body=input(), created=(await create(body)).data;
    const yesterday=Date.now()-86400000, oldDate=businessDate(yesterday,'Asia/Shanghai');
    // Test fixture simulates a previously persisted incident; no app endpoint permits these updates.
    await db.prepare('UPDATE audit_record SET recorded_at=?, recorded_date=?, occurred_at=?, occurred_date=? WHERE uid=?').bind(yesterday,oldDate,yesterday,oldDate,created.id).run();
    const recovery=await create(input({kind:'RECOVERY',incidentId:created.id,content:'今天确认恢复'}));
    expect(recovery.status).toBe(201); expect(recovery.data.recordedDate).not.toBe(oldDate);
    const timeline=await request(`/api/audit/records?incident=${created.id}`);
    expect(timeline.data.items.map((r:any)=>r.id)).toEqual([created.id,recovery.data.id]);
    const oldRetry=await create(body); expect(oldRetry.status).toBe(200); expect(oldRetry.data.id).toBe(created.id);
  });
  it('allows admin void annotations, retains the original and rejects ordinary void',async()=>{
    const body=input({kind:'VOID',incidentId:root.id,targetId:root.id,content:'重复告警，标记作废，原报告保留。'});
    expect((await create(body)).status).toBe(403);
    expect((await create(body,admin)).status).toBe(201);
    const original=(await request(`/api/audit/records/${root.id}`)).data;
    expect(original.voided).toBe(true); expect(original.content).toBe(root.content);
  });
  it('supports Chinese search, literal wildcard search, filename and date filters',async()=>{
    for(const q of ['支付接口','100%','under_score','告警截图']) {
      const result=await request(`/api/audit/records?all=1&q=${encodeURIComponent(q)}`);
      expect(result.data.items.some((r:any)=>r.id===root.id),q).toBe(true);
    }
    expect((await request('/api/audit/records?date=2026-02-30')).status).toBe(400);
    expect((await request('/api/audit/records?dateField=content')).status).toBe(400);
    expect((await request('/api/audit/records?all=1&after=-1')).status).toBe(400);
  });
  it('keeps stable, complete keyset export pages while new records arrive',async()=>{
    for(let i=0;i<51;i++) expect((await create(input({title:`分页 ${i}`}))).status).toBe(201);
    const first=await request('/api/audit/export?all=1');
    expect(first.data.items).toHaveLength(50); expect(first.data.nextCursor).toBeTruthy();
    const newer=(await create()).data;
    const secondPage=await request(`/api/audit/export?all=1&after=${first.data.nextCursor}&until=${first.data.snapshotMaxId}`);
    const all=[...first.data.items,...secondPage.data.items];
    expect(new Set(all.map((r:any)=>r.id)).size).toBe(all.length);
    expect(all.some((r:any)=>r.id===newer.id)).toBe(false);
    expect(all.length).toBe((await db.prepare('SELECT COUNT(*) AS n FROM audit_record WHERE id<=?').bind(first.data.snapshotMaxId).first()).n);
  });
  it('restricts operation logs to admins and never includes account passwords',async()=>{
    expect((await request('/api/audit/logs')).status).toBe(403);
    const logs=await request('/api/audit/logs',undefined,admin);
    expect(logs.status).toBe(200); expect(JSON.stringify(logs.data)).not.toContain(PASSWORD);
    expect(logs.data.items.some((row:any)=>row.action==='CREATE_USER')).toBe(true);
  });
  it('preserves historical actor identity snapshots after profile changes',async()=>{
    expect((await rpc('UserService','UpdateUser',{user:{name:'users/operator-one',displayName:'新名字'},updateMask:'displayName'},member)).status).toBe(200);
    expect((await request(`/api/audit/records/${root.id}`)).data.actor.displayName).toBe(root.actor.displayName);
  });
  it('blocks self-demotion and disables account access without removing history',async()=>{
    expect((await rpc('UserService','UpdateUser',{user:{name:'users/audit-admin',state:'ARCHIVED'},updateMask:'state'})).status).toBe(400);
    expect((await rpc('UserService','UpdateUser',{user:{name:'users/operator-two',state:'ARCHIVED'},updateMask:'state'})).status).toBe(200);
    expect((await request('/api/audit/records',undefined,second)).status).toBe(401);
    expect((await request(`/api/audit/records/${root.id}`)).status).toBe(200);
  });
  it('blocks cross-origin requests',async()=>{
    const response=await mf.dispatchFetch('https://audit.test/api/audit/records',{method:'POST',headers:{Origin:'https://hostile.test',Authorization:`Bearer ${member}`,'Content-Type':'application/json'},body:JSON.stringify(input())});
    expect(response.status).toBe(403);
  });
});
