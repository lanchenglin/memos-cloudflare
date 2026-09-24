import type { Env } from "./types";
import { ConnectError, invalidArgument, permissionDenied } from "./v2/connect";

/** Bound actual bytes, not just the untrusted Content-Length header. */
export async function readLimitedBody(req: Request, limit: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("Content-Length"));
  if (declared > limit) throw new ConnectError("resource_exhausted", `请求超过 ${limit} 字节限制`);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ConnectError("resource_exhausted", `请求超过 ${limit} 字节限制`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) {
    throw invalidArgument("密码需要 12–128 个字符，请使用独立的长密码");
  }
}

export async function verifySetupKey(env: Env, req: Request): Promise<void> {
  if (!env.SETUP_KEY || env.SETUP_KEY.length < 32) {
    throw new ConnectError("failed_precondition", "请先在 Worker Secrets 设置至少 32 字符的 SETUP_KEY");
  }
  const supplied = req.headers.get("X-Setup-Key") || "";
  if (supplied.length > 256) throw permissionDenied("初始化密钥不正确");
  const digest = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [expected, actual] = await Promise.all([digest(env.SETUP_KEY), digest(supplied)]);
  const a = new Uint8Array(expected), b = new Uint8Array(actual);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference !== 0) throw permissionDenied("初始化密钥不正确");
}

/** Atomic D1 counter: no per-isolate, best-effort in-memory login limiter. */
export async function limitAuth(env: Env, req: Request, scope: string, maximum = 20): Promise<void> {
  const ip = req.headers.get("CF-Connecting-IP") || "local-development";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${scope}:${ip}`));
  const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`INSERT INTO auth_throttle (key, attempts, reset_ts) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN reset_ts <= ? THEN 1 ELSE attempts + 1 END,
      reset_ts = CASE WHEN reset_ts <= ? THEN excluded.reset_ts ELSE reset_ts END
    RETURNING attempts`).bind(key, now + 600, now, now).first<{attempts: number}>();
  if ((row?.attempts ?? maximum + 1) > maximum) {
    throw new ConnectError("resource_exhausted", "尝试过于频繁，请在 10 分钟后重试");
  }
}

export async function cleanup(env: Env): Promise<void> {
  const queue = await env.DB.prepare("SELECT object_key FROM r2_deletion_queue ORDER BY created_ts LIMIT 100")
    .all<{object_key: string}>();
  if (env.R2) {
    for (const row of queue.results) {
      try {
        await env.R2.delete(row.object_key);
        await env.DB.prepare("DELETE FROM r2_deletion_queue WHERE object_key = ?").bind(row.object_key).run();
      } catch { console.error("R2 deletion deferred; queue entry retained"); }
    }
  }
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_throttle WHERE reset_ts < ?").bind(now),
    env.DB.prepare("DELETE FROM refresh_token WHERE expires_ts < ? OR (rotated_ts IS NOT NULL AND rotated_ts < ?)")
      .bind(now, now - 60),
  ]);
}
