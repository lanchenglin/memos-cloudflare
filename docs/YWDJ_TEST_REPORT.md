# ywdj 第一版实际测试报告

测试日期：2026-09-30。分支：`ywdj`。起始基线：`0383b3ee90acdda3b60c7b011ba0dd668ad62fbe`。

本报告对应同次提交的应用实现、迁移和测试脚本。使用独立开发工作区、临时 D1/R2 和测试账号，没有连接生产数据库或修改现有 Cloudflare 站点。

## 汇总

| 检查 | 结果 | 范围 |
|---|---|---|
| `npm run check` | PASS | 后端及前端 TypeScript 类型检查 |
| `npm test --prefix backend` | PASS，56 项 | 27 项审计专用测试 + 29 项个人版测试入口回归 |
| `npm test --prefix frontend -- --maxWorkers=1` | PASS，138 项 / 28 文件 | 含 7 项 ywdj 新测试、路由保护和保留组件回归 |
| `python3 -m unittest discover -s scripts/tests` | PASS，12 项 | 6 项新审计备份测试 + 6 项保留备份测试 |
| `npm run build` | PASS | 最终前端生产构建 |
| `npm run build:check --prefix backend` | PASS | Wrangler 本地 dry-run，未执行真实发布 |
| `npm run test:browser` | PASS，13 个流程检查点 | 实际 Chromium Headless Shell + workerd + 临时 D1/R2 |
| `git diff --check` | PASS | 空白和补丁格式检查 |
| 线上部署和真实站点验收 | NOT_RUN | 本次用户授权是切分支、开始实现，不是发布生产 |

自动化测试共 **206 项**（56 + 138 + 12），另有 **13 个浏览器流程检查点**。不能把这些数目理解为所有可能风险已穷尽。

环境：Node.js 24.18.1；项目锁定的 Wrangler 4.137.0、Miniflare 5.20260921.0-alpha、Vitest 4.1.11；Playwright 配套 Chromium Headless Shell 153.0.8010.12。前端最终回归采用单 worker 串行运行，避免共享开发机资源竞争。

## 后端审计测试覆盖

`backend/tests/audit.test.ts` 使用真正 workerd 执行正式 `src/index.ts`，由 Miniflare 提供本地 D1/R2。不是仅 Mock 权限函数。

- 上海时区午夜边界、明确时区的时间解析、DST 时区、拒绝昨天/未来/无时区/无效日期，服务器生成登记时间和身份快照。
- 匿名读取被拒绝，普通访客不能注册；即使旧实例设置被改成允许注册，也不能绕过审计版管理员建号规则。
- 拒绝客户端注入登记时间、作者、公开可见性和归档状态；正式记录 PATCH/PUT/DELETE 对普通用户和管理员均返回拒绝。
- 拒绝旧笔记创建/更新/删除/分享/重绑定附件入口，以及删除用户级联入口。
- 草稿附件仅上传者可读；正式证据团队可读、匿名不可读；SVG/伪类型/超限上传被拒绝。
- 正式附件不能删除或重新绑定；不存在、被其他记录占用或属于其他用户的附件使整个登记事务回滚，不留下半条记录。
- 并发重复提交去重；相同请求编号但不同正文被拒绝；两条记录并发争抢同一附件只有一条成功。
- 更正必须关联同一事故中的原记录，原文不被覆盖；今天可以为旧事故追加恢复说明；重试查重先于日期校验。
- 管理员作废以新增说明表达，原文保留，普通用户不能作废。
- 中文、附件名和字面百分号/下划线搜索；完整分页导出使用固定最大序号快照，新增记录不干扰已有导出页。
- 操作审计只允许管理员读取；不记录测试密码；账号改名不重写已提交身份快照；停用账号立即失去访问权，历史仍保留。
- 跨站请求被拒绝。

`backend/tests/personal.test.ts` 的 29 项通过的是 `tests/fixtures/personal-worker.ts` 测试入口，目的是避免破坏共用基础代码。**不能据此推断 ywdj 开放个人版的编辑、删除或分享能力**；生产入口固定启用审计规则。

## 真实浏览器通过的 13 个流程

1. 首位管理员通过初始化密钥建号、登录并进入运维登记页。
2. 管理员通过页面创建普通成员。
3. 中文正文和原始图片提交成功，页面显示锁定，不出现编辑/删除按钮。
4. 新增更正关联到同一事故，原记录内容仍然保留。
5. 刷新后事故链和需要登录的原始证据正常显示。
6. 网页导出完整事故链的两条正式记录，不只导出当前可见元素。
7. 320px 和 390px 页面宽度无横向溢出，生成桌面/手机截图。
8. 管理员可以查看自动生成的系统审计。
9. 普通成员可查团队记录，但看不到管理员作废/操作审计入口，直接 DELETE 请求被后端拒绝。
10. 模拟“服务端已写入、浏览器丢失响应”：刷新后恢复原请求，再提交只产生一条记录。
11. 中文附件文件名搜索找回原事故。
12. 便携备份实际取得 3 条正式记录与 1 个原始附件，原字节比对及 SHA-256 校验通过；普通成员备份不包含管理员日志。
13. 独立匿名浏览器不能访问正式证据文件。

脚本位于 `backend/tests/browser-smoke.mjs`。运行成功后生成 `test-results/ywdj-browser-results.json`、`ywdj-desktop.png`、`ywdj-mobile.png`；这些是运行产物，不提交到 Git。

## 实际修复和验证边界

浏览器排查发现首次建号后经首页重定向、懒加载进入审计页时会空白。现改为受保护的首页直接渲染审计入口，并为审计页面增加明确 Suspense 加载边界；完整建号登录流程已经重新通过。

同时修正成员用户名输入的 HTML 正则兼容性，移除 ywdj 不使用的旧个人笔记 SSE 重连，避免不断请求不存在的接口。发生时分绑定填写时的业务日期，跨天不会悄悄按新日期解释。

完整有界面 Chrome 的早期测试驱动出现协议断言，不作为通过依据；最终实际通过的是 Playwright 配套 Headless Shell。没有宣称已在所有浏览器、真实手机或弱网环境逐一验收。页面截图和布局断言不等同真人手机全面体验测试。

生产构建仍有通用的大体积 chunk 提示，未阻止构建；此版未开展首屏性能/大规模数据压测。没有执行 npm audit、线上权限审计、真实资源恢复演练或正式部署；没有修改数据库管理员权限、启用 R2 保留锁或实现合规认证。

## 复验

```bash
npm run check
npm test --prefix backend
npm test --prefix frontend -- --maxWorkers=1
python3 -m unittest discover -s scripts/tests
npm run build
npm run build:check --prefix backend
npm run test:browser
```

浏览器默认使用 Playwright 配套无头 Chromium。首次缺浏览器时，在 backend 目录执行 `npx playwright-core install chromium`。所有生产部署、首次正式备份与真实站点验收另按 `YWDJ_DEPLOY.md` 执行。
