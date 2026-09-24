import { Hono } from "hono";
import type { Env } from "./types";
import { mountConnectRoutes } from "./v2/router";
import { mountFileServer } from "./v2/fileserver";
import { mountPersonalRoutes } from "./personal";
import { ConnectError } from "./v2/connect";
import { cleanup } from "./security";
import "./v2/services";

const app = new Hono<{ Bindings: Env }>();

// Deliberately same-origin only: deploy the web UI and API as ONE Worker.
// No reflected credentialed CORS and no v1 legacy routes / public file bypass.
app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ code: "permission_denied", message: "Cross-origin requests are disabled" }, 403);
  }
  if (c.req.header("Sec-Fetch-Site") === "cross-site" && c.req.path.startsWith("/file/")) {
    return c.text("Cross-site media requests are disabled", 403);
  }
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS" &&
      (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32)) {
    return c.json({ code: "failed_precondition", message: "Set JWT_SECRET to a random value of at least 32 characters" }, 503);
  }
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/memos.api.")) {
    c.header("Cache-Control", "private, no-store");
  }
});

app.get("/health", c => c.json({ status: "ok", service: "memos-cloudflare-personal", version: "0.3.0" }));
mountConnectRoutes(app);
mountFileServer(app);
mountPersonalRoutes(app);

app.notFound(async c => {
  const path = c.req.path;
  if (path.startsWith("/api/") || path.startsWith("/file/") || path.startsWith("/memos.api.") || path.startsWith("/o/r/")) {
    return c.json({ code: "not_found", message: "Not Found" }, 404);
  }
  if (c.env.ASSETS && (c.req.method === "GET" || c.req.method === "HEAD")) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ code: "not_found", message: "Not Found" }, 404);
});
app.onError((error, c) => {
  if (error instanceof ConnectError) {
    return new Response(JSON.stringify(error.toBody()), {
      status: error.httpStatus,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  console.error("Unhandled request error", error instanceof Error ? error.name : "unknown");
  return c.json({ code: "internal", message: "Internal server error" }, 500);
});

export { app };
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanup(env));
  },
};
