import type { Env } from "./types";
import type { AuthContext } from "./v2/auth";
import { ConnectError, invalidArgument, permissionDenied } from "./v2/connect";
import { attachmentToApi, type AttachmentRow, newUid, parseName, safeParse, UID_MATCHER } from "./v2/store";

export function uploadLimit(env: Env): number {
  const configured = Number(env.UPLOAD_LIMIT_MB || 10);
  return (Number.isFinite(configured) ? Math.min(20, Math.max(1, configured)) : 10) * 1024 * 1024;
}

function detectedType(bytes: Uint8Array): string {
  const prefix = Array.from(bytes.slice(0, 12), b => String.fromCharCode(b)).join("");
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 13 && (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a"))) return "image/gif";
  if (bytes.length >= 16 && prefix.startsWith("RIFF") && prefix.slice(8,12) === "WEBP") return "image/webp";
  if (bytes.length >= 24 && prefix.slice(4,8) === "ftyp") {
    const brands = new TextDecoder().decode(bytes.slice(8, 32));
    if (brands.includes("avif") || brands.includes("avis")) return "image/avif";
  }
  if (prefix.startsWith("%PDF-")) return "application/pdf";
  throw invalidArgument("支持 JPG、PNG、GIF、WebP、AVIF 图片和 PDF；不接受 SVG/HTML 或伪装类型。HEIC 请先转换为 JPG。");
}

export async function saveAttachment(env: Env, auth: AuthContext, input: {
  bytes: Uint8Array; filename: string; uid?: string; memo?: string;
}): Promise<Record<string, unknown>> {
  if (!env.R2) throw new ConnectError("failed_precondition", "请先绑定名为 R2 的私有存储桶");
  if (!input.bytes.length || input.bytes.length > uploadLimit(env)) {
    throw invalidArgument(`文件必须非空，且不能超过 ${uploadLimit(env) / 1024 / 1024} MiB`);
  }
  if (typeof input.filename !== "string") throw invalidArgument("filename is required");
  const filename = input.filename.replace(/[\\/\x00-\x1f\x7f]/g, "_").trim().slice(0, 180);
  if (!filename) throw invalidArgument("filename is required");
  const type = detectedType(input.bytes);
  const uid = input.uid || newUid();
  if (!UID_MATCHER.test(uid)) throw invalidArgument("invalid attachment ID");
  const digest = await crypto.subtle.digest("SHA-256", input.bytes as unknown as ArrayBuffer);
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const lookup = () => env.DB.prepare(`SELECT a.*, m.uid AS memo_uid FROM attachment a LEFT JOIN memo m ON m.id = a.memo_id WHERE a.uid = ?`)
    .bind(uid).first<AttachmentRow>();
  const existing = await lookup();
  const sameUpload = (row: AttachmentRow) => row.creator_id === auth.userId && safeParse(row.payload).sha256 === sha256;
  if (existing) {
    if (sameUpload(existing)) return attachmentToApi(existing);
    throw new ConnectError("already_exists", "附件 ID 已存在，但不是同一文件");
  }
  let memoId: number | null = null;
  if (input.memo) {
    const memoUid = parseName(input.memo, "memos");
    const memo = memoUid ? await env.DB.prepare("SELECT id, creator_id FROM memo WHERE uid = ?")
      .bind(memoUid).first<{id: number; creator_id: number}>() : null;
    if (!memo || memo.creator_id !== auth.userId) throw permissionDenied("不能绑定到其他人的笔记");
    memoId = memo.id;
  }
  // A new immutable key per attempt prevents concurrent retries from overwriting
  // or deleting the object belonging to the successful request.
  const key = `attachments/${auth.userId}/${uid}/${crypto.randomUUID()}`;
  await env.R2.put(key, input.bytes as unknown as ArrayBuffer, { httpMetadata: { contentType: type } });
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(`INSERT INTO attachment
      (uid, creator_id, created_ts, updated_ts, filename, type, size, memo_id, storage_type, reference, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'R2', ?, ?)`)
      .bind(uid, auth.userId, now, now, filename, type, input.bytes.length, memoId, key, JSON.stringify({sha256})).run();
  } catch (error) {
    // Persist cleanup intent before attempting compensation, so an R2 outage is retryable.
    await env.DB.prepare("INSERT OR IGNORE INTO r2_deletion_queue (object_key) VALUES (?)").bind(key).run();
    try {
      await env.R2.delete(key);
      await env.DB.prepare("DELETE FROM r2_deletion_queue WHERE object_key = ?").bind(key).run();
    } catch { console.error("Upload compensation queued"); }
    const winner = await lookup();
    if (winner && sameUpload(winner)) return attachmentToApi(winner);
    throw error;
  }
  const created = await lookup();
  if (!created) throw new ConnectError("internal", "attachment metadata missing after upload");
  return attachmentToApi(created);
}
