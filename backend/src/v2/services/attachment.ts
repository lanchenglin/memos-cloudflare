import { saveAttachment } from "../../media";
// AttachmentService — 附件上传/列表/删除(blob 存 R2,元数据存 D1)。
// 对齐 memos v0.29 proto/api/v1/attachment_service.proto(规格书 §2.7 / §4.3)。
// GetAttachment / UpdateAttachment 前端未调用,不注册(router 统一回 unimplemented)。

import type { Env } from "../../types";
import { rpc } from "../router";
import { ConnectError, invalidArgument, notFound, permissionDenied } from "../connect";
import {
  type AttachmentRow,
  UID_MATCHER,
  attachmentToApi,
  encodePageToken,
  newUid,
  parseName,
  resolvePage,
  safeParse,
} from "../store";

const DEFAULT_UPLOAD_LIMIT_MB = 32;

const ATTACHMENT_SELECT = `SELECT a.*, m.uid AS memo_uid FROM attachment a LEFT JOIN memo m ON m.id = a.memo_id`;

/** proto3 JSON 的 bytes 为 base64(接受标准与 url-safe 两种字母表)。 */
const decodeBase64 = (input: string): Uint8Array => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    throw invalidArgument("attachment content is not valid base64");
  }
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

/** 读 STORAGE 设置中的 uploadSizeLimitMb(默认 32)。 */
const getUploadSizeLimitBytes = async (env: Env): Promise<number> => {
  const row = await env.DB.prepare("SELECT value FROM system_setting WHERE name = 'STORAGE'").first<{ value: string }>();
  const setting = safeParse(row?.value);
  const mb = typeof setting.uploadSizeLimitMb === "number" && setting.uploadSizeLimitMb > 0
    ? setting.uploadSizeLimitMb
    : DEFAULT_UPLOAD_LIMIT_MB;
  return mb * 1024 * 1024;
};

const getAttachmentByUid = (env: Env, uid: string) =>
  env.DB.prepare(`${ATTACHMENT_SELECT} WHERE a.uid = ?`).bind(uid).first<AttachmentRow>();

// ---------- CreateAttachment ----------

rpc("AttachmentService", "CreateAttachment", "required", async (request, ctx) => {
  const attachment = request?.attachment;
  if (!attachment || typeof attachment.content !== "string") throw invalidArgument("attachment content is required");
  return saveAttachment(ctx.env, ctx.auth!, {
    bytes: decodeBase64(attachment.content), filename: attachment.filename,
    uid: request.attachmentId, memo: attachment.memo,
  });
});

// ---------- ListAttachments ----------

const ORDER_FIELDS: Record<string, string> = {
  create_time: "a.created_ts",
  update_time: "a.updated_ts",
  filename: "a.filename",
  size: "a.size",
  name: "a.uid",
};

/** AIP-132 orderBy(逗号分隔 "field [asc|desc]"),仅支持白名单字段,默认 create_time desc。 */
const parseOrderBy = (orderBy: string | undefined): string => {
  const clauses: string[] = [];
  for (const part of (orderBy || "").split(",")) {
    const m = part.trim().match(/^(\w+)(?:\s+(asc|desc))?$/i);
    if (!m) continue;
    const column = ORDER_FIELDS[m[1]];
    if (!column) continue;
    clauses.push(`${column} ${m[2]?.toLowerCase() === "asc" ? "ASC" : "DESC"}`);
  }
  if (clauses.length === 0) clauses.push("a.created_ts DESC");
  clauses.push("a.id DESC"); // 稳定次序
  return clauses.join(", ");
};

rpc("AttachmentService", "ListAttachments", "required", async (request, ctx) => {
  const auth = ctx.auth!;
  const { limit, offset } = resolvePage(request);

  // 范围:本人的附件;ADMIN 可见全部(规格书 §2.7)。filter 暂不支持(前端主要靠客户端分组)。
  const where = auth.role === "ADMIN" ? "" : " WHERE a.creator_id = ?";
  const params = auth.role === "ADMIN" ? [] : [auth.userId];

  const [rows, count] = await Promise.all([
    ctx.env.DB.prepare(`${ATTACHMENT_SELECT}${where} ORDER BY ${parseOrderBy(request.orderBy)} LIMIT ? OFFSET ?`)
      .bind(...params, limit, offset)
      .all<AttachmentRow>(),
    ctx.env.DB.prepare(`SELECT COUNT(*) AS c FROM attachment a${where}`)
      .bind(...params)
      .first<{ c: number }>(),
  ]);

  const total = count?.c ?? 0;
  return {
    attachments: (rows.results ?? []).map(attachmentToApi),
    nextPageToken: offset + limit < total ? encodePageToken(limit, offset + limit) : "",
    totalSize: total,
  };
});

// ---------- DeleteAttachment / BatchDeleteAttachments ----------

const deleteAttachmentByName = async (env: Env, auth: { userId: number; role: string }, name: string) => {
  const uid = parseName(name, "attachments");
  if (!uid) throw invalidArgument(`invalid attachment name: ${name}`);
  const row = await env.DB.prepare("SELECT id, creator_id, storage_type, reference FROM attachment WHERE uid = ?")
    .bind(uid)
    .first<{ id: number; creator_id: number; storage_type: string; reference: string }>();
  if (!row) throw notFound(`attachment ${name} not found`);
  if (row.creator_id !== auth.userId && auth.role !== "ADMIN") throw permissionDenied();

  const statements = [];
  if (row.storage_type === "R2" && row.reference) {
    statements.push(env.DB.prepare("INSERT OR IGNORE INTO r2_deletion_queue (object_key) VALUES (?)").bind(row.reference));
  }
  statements.push(env.DB.prepare("DELETE FROM attachment WHERE id = ?").bind(row.id));
  await env.DB.batch(statements);
  if (row.storage_type === "R2" && row.reference && env.R2) {
    try {
      await env.R2.delete(row.reference);
      await env.DB.prepare("DELETE FROM r2_deletion_queue WHERE object_key = ?").bind(row.reference).run();
    } catch { console.error("Attachment removed; R2 deletion remains queued"); }
  }
};

rpc("AttachmentService", "DeleteAttachment", "required", async (request, ctx) => {
  if (!request.name) throw invalidArgument("name is required");
  await deleteAttachmentByName(ctx.env, ctx.auth!, request.name);
  return {};
});

rpc("AttachmentService", "BatchDeleteAttachments", "required", async (request, ctx) => {
  const names: string[] = Array.isArray(request.names) ? request.names : [];
  if (names.length === 0) throw invalidArgument("names is required");
  for (const name of names) {
    await deleteAttachmentByName(ctx.env, ctx.auth!, name);
  }
  return {};
});
