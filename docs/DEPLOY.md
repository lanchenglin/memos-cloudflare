# Cloudflare 部署（新实例）

## 1. 准备代码和工具

需要 Node.js 24+、npm，以及可以管理 Workers、D1、R2 的 Cloudflare 账号。前后端作为同一个 Worker 部署，不拆分到不同域名。

```bash
git clone https://github.com/lanchenglin/memos-cloudflare.git
cd memos-cloudflare
npm run setup
npm run check
npm test
npm run build
cd backend
npx wrangler login
```

## 2. 建立数据资源

以下命令会在你选择的 Cloudflare 账号创建远程资源，请确认账号和资源名。已有同名资源应先检查，不要直接删除重建。

```bash
npx wrangler d1 create memos
npx wrangler r2 bucket create memos-assets
```

将新建 D1 返回的 `database_id` 填入 `backend/wrangler.toml` 的占位符。确认 D1 绑定名为 `DB`，R2 绑定名为 `R2`，桶名与配置一致。不要使用上游作者的资源 ID。

**R2 保持私有：不要启用 r2.dev 公共访问，不要给桶绑定公共自定义域名，不设置公开下载地址。** 本项目通过 Worker 检查图片访问权限，公开桶会绕过这一层检查。

## 3. 设置两个不同的随机 Secret

分别生成至少 32 字符的高随机性值，例如在本机分别运行两次 `openssl rand -hex 32`。通过命令行交互粘贴，不写进 Git、命令参数或普通 vars：

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put SETUP_KEY
```

`JWT_SECRET` 签名登录会话。`SETUP_KEY` 仅用于首次建立管理员；它不是管理员密码。将其保存在密码管理器中，初始化后可通过 `npx wrangler secret delete SETUP_KEY` 删除这一 Secret，现有登录不依赖它。

命令可能要求先建立 Worker，按 CLI 指引创建同名空 Worker 即可。不要在 Secret 尚未配置时向公众发布可注册的旧版代码。

## 4. 迁移数据库并部署

```bash
# 在 backend 目录
npm run db:migrate:remote
npm run build:check
npm run deploy
```

`db:migrate:remote` 执行 `migrations/0001_v2.sql` 和 `0002_personal.sql`，迁移记录由 Wrangler 管理；日后重复执行只运行新的迁移。**不要用 schema-v2.sql 代替完整迁移目录。**

此版默认面向新建数据库。已有原版 Memos 或社区旧版数据时，不要直接对旧库执行 0001，也不要删除旧库；先做 D1 和 R2 完整备份，再单独评估结构迁移。

## 5. 首次初始化

打开部署得到的 HTTPS 地址，页面会引导创建首个管理员。输入 SETUP_KEY、自选用户名和 12–128 字符的长密码。没有预置账号和默认密码。

初始化后默认禁止开放注册。新笔记默认 PRIVATE；改成 PUBLIC 会允许匿名访问该笔记及其附件，PROTECTED 表示已登录用户可读，不等于仅自己可读。个人使用建议保持 PRIVATE。

## 6. 绑定自己的域名

在 Cloudflare 的该 Worker 设置中添加 Custom Domain，例如 `notes.example.com`。也可以在 `wrangler.toml` 顶层添加：

```toml
[[routes]]
pattern = "notes.example.com"
custom_domain = true
```

域名所属区域需要由你的 Cloudflare 账号管理。绑定后重新部署，并用该域名登录。前端 API 默认为同源，不要把 `VITE_API_BASE_URL` 指到另一个域名。

保留 `workers.dev` 时，它和自定义域名共享同一数据，但浏览器登录 Cookie 分属各自域名，需要分别登录。自定义域名验证成功后，可以在 Worker 设置中关闭不需要的预览入口。

## 7. 上线验收

创建一条文字笔记、一条纯图片笔记和一条多图笔记；用中文正文和文件名搜索。刷新后图片应仍显示，退出登录或使用无痕窗口访问私有图片应被拒绝。用手机打开域名，验证上传、预览和标签筛选。

执行一次图文备份并校验，并另行建立 D1/R2 的灾备流程。Cron 只负责删除队列和过期登录记录清理，**不是定时备份**。

## 参数与故障检查

`UPLOAD_LIMIT_MB` 默认 10，可设 1–20。修改后重新部署。文件被拒绝时先检查实际大小和格式；HEIC、SVG、HTML 不在支持范围，修改扩展名不会绕过服务端类型检查。

图片 401/404：确认使用同一域名、已登录、刷新 Cookie 有效、R2 绑定正确，不要为了修复显示问题把桶公开。

初始化 403：检查 SETUP_KEY，而不是放开注册。503：检查 JWT_SECRET 是否存在且至少 32 字符。数据库报列不存在：确认两次迁移都已完成。

配置验证、Miniflare 测试或浏览器本地测试通过，不等同你的 Cloudflare 账号、域名和真实 R2 已经上线验收。
