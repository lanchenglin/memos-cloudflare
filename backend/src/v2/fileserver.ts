import { Hono } from "hono";
import type { Env } from "../types";
import { authenticateMedia } from "./auth";

// Authenticated same-origin media, including ordinary <img> and download links.
// Never redirect to a public R2 URL, and never cache private content in shared caches.
export function mountFileServer(app: Hono<{ Bindings: Env }>) {
  app.on(["GET", "HEAD"], "/file/attachments/:uid/:filename", async c => {
    const row = await c.env.DB.prepare(`SELECT a.uid, a.filename, a.type, a.storage_type, a.reference, a.creator_id, m.visibility
      FROM attachment a LEFT JOIN memo m ON a.memo_id = m.id WHERE a.uid = ?`)
      .bind(c.req.param("uid")).first<{
        uid: string; filename: string; type: string; storage_type: string;
        reference: string; creator_id: number; visibility: string | null;
      }>();
    if (!row) return c.text("Not found", 404);
    if (row.visibility !== "PUBLIC") {
      const auth = await authenticateMedia(c.req.raw, c.env);
      if (!auth) return c.text("Unauthenticated", 401);
      if (auth.userId !== row.creator_id && auth.role !== "ADMIN" && row.visibility !== "PROTECTED") {
        return c.text("Not found", 404);
      }
    }
    if (row.storage_type !== "R2" || !row.reference || !c.env.R2) return c.text("File not available", 404);
    const object = await c.env.R2.get(row.reference);
    if (!object) return c.text("File not found", 404);
    const inline = /^image\/(png|jpeg|gif|webp|avif)$/.test(row.type);
    return new Response(c.req.method === "HEAD" ? null : object.body, {
      headers: {
        "Content-Type": inline ? row.type : "application/octet-stream",
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/'/g, "%27")}`,
      },
    });
  });
}
