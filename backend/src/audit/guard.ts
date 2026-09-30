import type { Hono } from 'hono';
import type { Env } from '../types';
import { authenticate } from '../v2/auth';
import { permissionDenied, unauthenticated } from '../v2/connect';
import { logStatement } from './core';

/** A fixed production edition, not a client parameter or user-editable setting. */
export function mountAuditGuard(app: Hono<{ Bindings: Env }>) {
  app.use('*', async (c, next) => {
    const path = c.req.path;
    const blocked = /^\/memos\.api\.v1\.(MemoService|AttachmentService)\//.test(path) ||
      path === '/memos.api.v1.UserService/DeleteUser' ||
      path.startsWith('/api/attachments/') || path.startsWith('/api/personal/') || path.startsWith('/file/attachments/');
    if (blocked) {
      const auth = await authenticate(c.req.raw, c.env);
      if (!auth) throw unauthenticated('请先登录');
      await logStatement(c.env, auth, 'BLOCK_LEGACY_ENDPOINT', path.slice(0, 200), { method: c.req.method }, 'DENIED').run();
      throw permissionDenied('运维登记版不开放个人笔记接口、公开分享或删除账号；请使用登记入口，停用账号代替删除');
    }
    await next();
  });
}
