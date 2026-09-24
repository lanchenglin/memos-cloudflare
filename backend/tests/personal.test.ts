import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync } from "node:fs";

// Synthetic credentials for an ephemeral local test database only.
const SECRET = "test-only-jwt-secret-never-use-in-production-123456";
const SETUP = "test-only-setup-key-never-use-in-production-123456";
const PASSWORD = "local-test-password-938174";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1kAAAAASUVORK5CYII=", "base64");
let mf: Miniflare;
let db: any;
let token = "", cookie = "", secondToken = "";
let attachment: any, memo: any;
let requestNumber = 0;
const api = async (service: string, method: string, body: unknown = {}, headers: Record<string,string> = {}) => {
  const response = await mf.dispatchFetch(`https://notes.test/memos.api.v1.${service}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": `test-${requestNumber++}`, ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`${response.status}: ${text}`); }
  return {response, data};
};
const owner = () => ({Authorization: `Bearer ${token}`});
const other = () => ({Authorization: `Bearer ${secondToken}`});
async function upload(id = "image-primary", bytes: Buffer = PNG, headers = owner(), filename = "中文截图.png") {
  const response = await mf.dispatchFetch(`https://notes.test/api/attachments/upload?filename=${encodeURIComponent(filename)}`, {
    method: "POST", headers: { ...headers, "X-Upload-ID": id, "Content-Type": "application/octet-stream" }, body: bytes,
  });
  return {response, data: await response.json() as any};
}
const fileUrl = (a = attachment) => `https://notes.test/file/${a.name}/${encodeURIComponent(a.filename)}`;

beforeAll(async () => {
  const bundled = await build({entryPoints:["src/index.ts"], bundle:true, format:"esm", platform:"browser", target:"es2022", write:false});
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name:"memos-test", modules:true, script:bundled.outputFiles[0].text,
    compatibilityDate:"2026-09-01", compatibilityFlags:["nodejs_compat"],
    d1Databases:{DB:"test-database"}, r2Buckets:{R2:"test-bucket"},
    bindings:{JWT_SECRET:SECRET, SETUP_KEY:SETUP, BASE_URL:"", UPLOAD_LIMIT_MB:"1"},
  }] }));
  db = await mf.getD1Database("DB");
  for (const file of ["migrations/0001_v2.sql", "migrations/0002_personal.sql"]) {
    // Keep trigger bodies intact while executing standard migration statements individually.
    const triggers: string[] = [];
    const sql = readFileSync(file,"utf8").replace(/--[^\n]*/g, "").replace(/CREATE TRIGGER[\s\S]*?END;/g, trigger => {
      triggers.push(trigger); return "";
    });
    for (const statement of sql.split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
    for (const trigger of triggers) await db.prepare(trigger).run();
  }
});
afterAll(async () => { await mf?.dispose(); });

describe.sequential("personal image notes on Workers + D1 + R2", () => {
  it("does not seed a default admin password", async () => {
    expect((await db.prepare("SELECT COUNT(*) AS n FROM user").first()).n).toBe(0);
    const {data} = await api("InstanceService", "GetInstanceProfile");
    expect(data.admin).toBeUndefined();
  });
  it("rejects missing and incorrect setup keys", async () => {
    for (const headers of [{}, {"X-Setup-Key":"incorrect"}]) {
      const {response} = await api("UserService","CreateUser",{user:{username:"owner",password:PASSWORD}},headers);
      expect(response.status).toBe(403);
    }
  });
  it("requires a long password even with the setup key", async () => {
    const {response} = await api("UserService","CreateUser",{user:{username:"owner",password:"123456"}},{"X-Setup-Key":SETUP});
    expect(response.status).toBe(400);
  });
  it("atomically initializes exactly one administrator", async () => {
    const results = await Promise.all(["owner", "racing-owner"].map(username =>
      api("UserService","CreateUser",{user:{username,password:PASSWORD}},{"X-Setup-Key":SETUP})));
    expect(results.filter(r => r.response.status === 200)).toHaveLength(1);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM user WHERE role = 'ADMIN'").first()).n).toBe(1);
    // Keep subsequent fixtures independent of which request won the race.
    await db.prepare("UPDATE user SET username = 'owner'").run();
  });
  it("blocks public registration after initialization", async () => {
    const {response} = await api("UserService","CreateUser",{user:{username:"stranger",password:PASSWORD}},{"X-Setup-Key":SETUP});
    expect(response.status).toBe(403);
  });
  it("signs in with Secure HttpOnly SameSite=Strict cookies", async () => {
    const {response,data} = await api("AuthService","SignIn",{passwordCredentials:{username:"owner",password:PASSWORD}});
    expect(response.status, JSON.stringify(data)).toBe(200);
    token = data.accessToken;
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("HttpOnly"); expect(setCookie).toContain("Secure"); expect(setCookie).toContain("SameSite=Strict");
    cookie = setCookie.split(";")[0];
  });
  it("creates an explicit second user for access-control tests", async () => {
    const created = await api("UserService","CreateUser",{user:{username:"second",password:PASSWORD,role:"USER"}},owner());
    expect(created.response.status, JSON.stringify(created.data)).toBe(200);
    const login = await api("AuthService","SignIn",{passwordCredentials:{username:"second",password:PASSWORD}});
    secondToken = login.data.accessToken;
    expect(secondToken).toBeTruthy();
  });
  it("rejects unauthenticated upload", async () => {
    expect((await upload("unauth",PNG,{})).response.status).toBe(401);
  });
  it("uploads original image bytes to R2 and metadata to D1", async () => {
    const {response,data} = await upload();
    expect(response.status,JSON.stringify(data)).toBe(200); attachment = data;
    expect(data.type).toBe("image/png"); expect(data.filename).toBe("中文截图.png");
    const row = await db.prepare("SELECT reference FROM attachment WHERE uid = ?").bind("image-primary").first();
    const bucket = await mf.getR2Bucket("R2");
    const object = await bucket.get(row.reference);
    expect(Buffer.from(await object!.arrayBuffer())).toEqual(PNG);
    expect(row.reference).not.toContain("中文截图");
  });
  it("idempotently retries an upload, including concurrent duplicates", async () => {
    const repeats = await Promise.all([upload(),upload()]);
    for (const result of repeats) expect(result.response.status).toBe(200);
    const concurrent = await Promise.all([upload("racing-image"),upload("racing-image")]);
    for (const result of concurrent) expect(result.response.status,JSON.stringify(result.data)).toBe(200);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM attachment WHERE uid = 'racing-image'").first()).n).toBe(1);
    expect((await (await mf.getR2Bucket("R2")).list()).objects).toHaveLength(2);
  });
  it("does not allow another user to reuse an upload ID", async () => {
    expect((await upload("image-primary",PNG,other())).response.status).toBe(409);
  });
  it("rejects HTML/SVG disguised as images and oversized bodies", async () => {
    expect((await upload("malicious-image",Buffer.from('<svg onload="alert(1)"></svg>'))).response.status).toBe(400);
    expect((await upload("huge-image",Buffer.alloc(1024*1024+1))).response.status).toBe(429);
  });
  it("creates a private text-and-image memo with Chinese tags", async () => {
    const result = await api("MemoService","CreateMemo",{memo:{content:"剪辑方法，保存原始图片。\n#待整理 #技术",attachments:[{name:attachment.name}]}},owner());
    expect(result.response.status,JSON.stringify(result.data)).toBe(200); memo=result.data;
    expect(memo.visibility).toBe("PRIVATE"); expect(memo.tags).toContain("待整理"); expect(memo.attachments).toHaveLength(1);
  });
  it("loads private images with browser cookies even when another cookie is first", async () => {
    const response = await mf.dispatchFetch(fileUrl(),{headers:{Cookie:`unrelated=1; ${cookie}`}});
    expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("blocks anonymous and other-user private image access", async () => {
    expect((await mf.dispatchFetch(fileUrl())).status).toBe(401);
    expect((await mf.dispatchFetch(fileUrl(),{headers:other()})).status).toBe(404);
    const response = await mf.dispatchFetch(fileUrl(),{method:"HEAD",headers:owner()});
    expect(response.status).toBe(200); expect(await response.text()).toBe("");
  });
  it("finds Chinese content, image filenames, review tags and image-only filters", async () => {
    for (const filter of ['content.contains("剪辑")','content.contains("中文截图")','tag == "待整理"','has_image']) {
      const {response,data} = await api("MemoService","ListMemos",{filter},owner());
      expect(response.status, JSON.stringify(data)).toBe(200);
      expect(data.memos.map((m:any)=>m.name)).toContain(memo.name);
    }
    const hidden = await api("MemoService","ListMemos",{filter:'content.contains("剪辑")'},other());
    expect(hidden.data.memos).toEqual([]);
  });
  it("treats LIKE wildcard characters as literal search text", async () => {
    const result = await api("MemoService","CreateMemo",{memo:{content:"完成 100% 和 under_score"}},owner());
    for (const filter of ['content.contains("100%")','content.contains("under_score")']) {
      const response = await api("MemoService","ListMemos",{filter},owner());
      expect(response.data.memos.map((m:any)=>m.name)).toEqual([result.data.name]);
    }
  });
  it("accepts real protobuf JSON string field masks for edit/pin/timestamp", async () => {
    const {response,data} = await api("MemoService","UpdateMemo",{
      memo:{name:memo.name,content:"剪辑方法已整理 #技术",pinned:true},updateMask:"content,pinned,updateTime",
    },owner());
    expect(response.status,JSON.stringify(data)).toBe(200); expect(data.pinned).toBe(true);
    expect(data.tags).toEqual(["技术"]); expect(data.attachments).toHaveLength(1);
  });
  it("keeps invalid attachment references from creating empty phantom notes", async () => {
    const before = (await db.prepare("SELECT COUNT(*) AS n FROM memo").first()).n;
    const result = await api("MemoService","CreateMemo",{memo:{attachments:[{name:"attachments/nonexistent"}]}},owner());
    expect(result.response.status).toBe(403);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM memo").first()).n).toBe(before);
  });
  it("prevents stealing an image already attached to another memo", async () => {
    const result = await api("MemoService","CreateMemo",{memo:{content:"bad",attachments:[{name:attachment.name}]}},owner());
    expect(result.response.status).toBe(403);
    const original = await api("MemoService","GetMemo",{name:memo.name},owner());
    expect(original.data.attachments).toHaveLength(1);
  });
  it("supports image-only notes and archived notes", async () => {
    const image = await upload("image-only");
    const created = await api("MemoService","CreateMemo",{memo:{attachments:[{name:image.data.name}]}},owner());
    expect(created.response.status).toBe(200); expect(created.data.content).toBe("");
    const archived = await api("MemoService","UpdateMemo",{memo:{name:created.data.name,state:"ARCHIVED"},updateMask:"state"},owner());
    expect(archived.data.state).toBe("ARCHIVED");
  });
  it("exports all own notes with keyset pagination, including archived notes", async () => {
    for(let i=0;i<53;i++) await db.prepare("INSERT INTO memo (uid,creator_id,content) VALUES (?,1,?)").bind(`bulk-${i}`,`测试 ${i}`).run();
    await api("MemoService","CreateMemo",{memo:{content:"other user's private note"}},other());
    const first = await (await mf.dispatchFetch("https://notes.test/api/personal/export",{headers:owner()})).json() as any;
    expect(first.memos).toHaveLength(50); expect(first.nextCursor).toBeTruthy();
    const second = await (await mf.dispatchFetch(`https://notes.test/api/personal/export?after=${first.nextCursor}&until=${first.snapshotMaxId}`,{headers:owner()})).json() as any;
    const all=[...first.memos,...second.memos];
    expect(all.every((m:any)=>m.creator==="users/owner")).toBe(true);
    expect(all.some((m:any)=>m.state==="ARCHIVED")).toBe(true);
    expect(new Set(all.map((m:any)=>m.name)).size).toBe(all.length);
  });
  it("caps page sizes and rejects malformed filters without a server crash", async () => {
    const result = await api("MemoService","ListMemos",{pageSize:1000},owner());
    expect(result.response.status,JSON.stringify(result.data)).toBe(200); expect(result.data.memos).toHaveLength(50);
    const bad = await api("MemoService","ListMemos",{filter:'content.contains("x"); DROP TABLE memo'},owner());
    expect(bad.response.status).toBe(400);
  });
  it("blocks cross-origin cookie mutations and legacy file bypasses", async () => {
    const request = await api("AuthService","SignOut",{}, {Origin:"https://other.test",Cookie:cookie});
    expect(request.response.status).toBe(403);
    expect((await mf.dispatchFetch("https://notes.test/o/r/image-primary/a.png")).status).toBe(404);
    expect((await mf.dispatchFetch("https://notes.test/api/does-not-exist")).status).toBe(404);
  });
  it("returns 401 for malformed JWTs, not a 500 or anonymous downgrade", async () => {
    const result = await api("MemoService","ListMemos",{}, {Authorization:"Bearer invalid.!.signature"});
    expect(result.response.status).toBe(401);
  });
  it("enforces a D1-backed authentication attempt limit", async () => {
    let status = 0;
    for(let i=0;i<21;i++) status=(await api("AuthService","SignIn",{passwordCredentials:{username:"nobody",password:PASSWORD}},
      {"CF-Connecting-IP":"rate-test-ip"})).response.status;
    expect(status).toBe(429);
  });
  it("deletes both attachment metadata and its R2 object", async () => {
    const created=await upload("delete-me");
    const row=await db.prepare("SELECT reference FROM attachment WHERE uid='delete-me'").first();
    const deleted=await api("AttachmentService","DeleteAttachment",{name:created.data.name},owner());
    expect(deleted.response.status).toBe(200);
    expect(await (await mf.getR2Bucket("R2")).get(row.reference)).toBeNull();
  });
  it("sign-out revokes private media cookie access immediately", async () => {
    const result=await api("AuthService","SignOut",{}, {Cookie:cookie});
    expect(result.response.status).toBe(200);
    expect((await mf.dispatchFetch(fileUrl(),{headers:{Cookie:cookie}})).status).toBe(401);
  });
  it("password change revokes old access JWT and refresh sessions", async () => {
    const login=await api("AuthService","SignIn",{passwordCredentials:{username:"owner",password:PASSWORD}});
    const oldToken=login.data.accessToken, oldCookie=login.response.headers.get("Set-Cookie")!.split(";")[0];
    const changed=await api("UserService","UpdateUser",{user:{name:"users/owner",password:"new-password-local-test-68379"},updateMask:"password"},{Authorization:`Bearer ${oldToken}`});
    expect(changed.response.status,JSON.stringify(changed.data)).toBe(200);
    expect((await api("MemoService","ListMemos",{}, {Authorization:`Bearer ${oldToken}`})).response.status).toBe(401);
    expect((await mf.dispatchFetch(fileUrl(),{headers:{Cookie:oldCookie}})).status).toBe(401);
  });
});
