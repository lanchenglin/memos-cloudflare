import { readLimitedBody } from "../security";
import { Hono } from "hono";
import type { Env } from "../types";
import { ConnectError, internal, unauthenticated, unimplemented } from "./connect";
import { authenticate, type AuthContext } from "./auth";

// 每个 RPC handler 收到解析后的请求 JSON 与上下文，返回响应 JSON。
export interface RpcContext {
  env: Env;
  req: Request;
  auth: AuthContext | null;
  /** 响应上的 Set-Cookie 等额外头，由 handler 按需写入 */
  responseHeaders: Headers;
}

export type RpcHandler = (request: any, ctx: RpcContext) => Promise<Record<string, unknown>>;

type AuthPolicy = "required" | "optional";

interface RpcRegistration {
  handler: RpcHandler;
  auth: AuthPolicy;
}

const registry = new Map<string, RpcRegistration>();

export function rpc(service: string, method: string, auth: AuthPolicy, handler: RpcHandler) {
  registry.set(`memos.api.v1.${service}/${method}`, { handler, auth });
}

/** 挂载 Connect JSON 路由。所有 RPC 都是 POST /memos.api.v1.<Service>/<Method> */
export function mountConnectRoutes(app: Hono<{ Bindings: Env }>) {
  // 路径形如 /memos.api.v1.MemoService/ListMemos。“.”不是段分隔符，
  // Hono 段内不支持静态前缀混写，这里用段内正则参数匹配整个 service 全名。
  app.post("/:service{memos\\.api\\.v1\\.[A-Za-z]+}/:method", async (c) => {
    const key = `${c.req.param("service")}/${c.req.param("method")}`;
    const registration = registry.get(key);

    try {
      if (!registration) {
        throw unimplemented(key);
      }

      let requestBody: any = {};
      if (!c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")) {
        throw new ConnectError("invalid_argument", "Content-Type must be application/json");
      }
      // Native image upload uses /api/attachments/upload; cap legacy base64 uploads.
      const raw = new TextDecoder().decode(await readLimitedBody(c.req.raw, 15 * 1024 * 1024));
      if (raw) {
        try {
          requestBody = JSON.parse(raw);
        } catch {
          throw new ConnectError("invalid_argument", "malformed JSON request body");
        }
      }

      if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
        throw new ConnectError("invalid_argument", "request must be a JSON object");
      }
      if (typeof requestBody.updateMask === "string") {
        requestBody.updateMask = { paths: requestBody.updateMask.split(",").filter(Boolean)
          .map((p: string) => p.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`)) };
      }
      const auth = await authenticate(c.req.raw, c.env);
      if (c.req.header("Authorization") && !auth) throw unauthenticated();
      if (registration.auth === "required" && !auth) {
        throw unauthenticated();
      }

      const responseHeaders = new Headers();
      const result = await registration.handler(requestBody, {
        env: c.env,
        req: c.req.raw,
        auth,
        responseHeaders,
      });

      responseHeaders.set("Content-Type", "application/json");
      return new Response(JSON.stringify(result ?? {}), { status: 200, headers: responseHeaders });
    } catch (err) {
      const connectErr =
        err instanceof ConnectError ? err : internal("Internal server error");
      if (!(err instanceof ConnectError)) {
        console.error(`RPC ${key} failed:`, err);
      }
      return new Response(JSON.stringify(connectErr.toBody()), {
        status: connectErr.httpStatus,
        headers: { "Content-Type": "application/json" },
      });
    }
  });
}
