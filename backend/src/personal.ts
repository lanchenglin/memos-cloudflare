import { Hono } from "hono";
import type { Env } from "./types";
import { authenticate } from "./v2/auth";
import { invalidArgument, unauthenticated } from "./v2/connect";
import { MEMO_SELECT, memosToApiWithExtras, type MemoRow } from "./v2/store";
import { readLimitedBody } from "./security";
import { saveAttachment, uploadLimit } from "./media";

export function mountPersonalRoutes(app: Hono<{Bindings: Env}>) {
  app.post("/api/attachments/upload", async c => {
    const auth = await authenticate(c.req.raw, c.env);
    if (!auth) throw unauthenticated();
    const bytes = await readLimitedBody(c.req.raw, uploadLimit(c.env));
    const attachment = await saveAttachment(c.env, auth, {
      bytes, filename: c.req.query("filename") || "", uid: c.req.header("X-Upload-ID"),
    });
    return c.json(attachment);
  });

  app.get("/api/personal/overview", async c => {
    const auth = await authenticate(c.req.raw, c.env);
    if (!auth) throw unauthenticated();
    const [memos, files, inbox] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) AS count FROM memo WHERE creator_id = ?").bind(auth.userId).first<{count: number}>(),
      c.env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS bytes FROM attachment WHERE creator_id = ?")
        .bind(auth.userId).first<{count: number; bytes: number}>(),
      c.env.DB.prepare(`SELECT COUNT(*) AS count FROM memo m WHERE creator_id = ? AND row_status = 'NORMAL'
        AND EXISTS (SELECT 1 FROM json_each(m.payload, '$.tags') WHERE value = '待整理')`)
        .bind(auth.userId).first<{count: number}>(),
    ]);
    return c.json({ storage: "R2", privateBucketRequired: true, uploadLimitBytes: uploadLimit(c.env),
      memoCount: memos?.count || 0, attachmentCount: files?.count || 0, attachmentBytes: files?.bytes || 0,
      inboxCount: inbox?.count || 0 });
  });

  // Keyset pagination, own notes only, archived included. Images remain authenticated
  // URLs; this endpoint is a metadata export, NOT a full image backup by itself.
  app.get("/api/personal/export", async c => {
    const auth = await authenticate(c.req.raw, c.env);
    if (!auth) throw unauthenticated();
    const after = Number(c.req.query("after") || 0);
    if (!Number.isSafeInteger(after) || after < 0) throw invalidArgument("Invalid cursor");
    let until = Number(c.req.query("until") || 0);
    if (!Number.isSafeInteger(until) || until < 0) throw invalidArgument("Invalid snapshot bound");
    if (!c.req.query("until")) {
      const max = await c.env.DB.prepare("SELECT COALESCE(MAX(id),0) AS id FROM memo WHERE creator_id = ?")
        .bind(auth.userId).first<{id: number}>();
      until = max?.id || 0;
    }
    const rows = await c.env.DB.prepare(`${MEMO_SELECT} WHERE m.creator_id = ? AND m.id > ? AND m.id <= ? ORDER BY m.id LIMIT 51`)
      .bind(auth.userId, after, until).all<MemoRow>();
    const page = rows.results.slice(0, 50);
    return c.json({ schemaVersion: 1, exportedAt: new Date().toISOString(), snapshotMaxId: until,
      memos: await memosToApiWithExtras(c.env, page),
      nextCursor: rows.results.length > 50 ? String(page[page.length - 1].id) : "" });
  });
}
