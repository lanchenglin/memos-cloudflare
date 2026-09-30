import { createApp } from "./application";
import { cleanup } from "./security";
import type { Env } from "./types";
// ywdj production entrypoint: application audit rules cannot be disabled by a request or setting.
const app = createApp(true);
export { app };
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(cleanup(env)); },
};
