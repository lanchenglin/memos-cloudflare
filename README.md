# 随手记 · Memos Cloudflare Personal

**先记录，再整理。** 面向个人的图文笔记：一个 Cloudflare Worker 提供网页和接口，D1 保存正文、标签和账号，私有 R2 保存原图和 PDF。无需家里的电脑保持开机。

> 本仓库是基于 [Allhuo/memos-cloudflare](https://github.com/Allhuo/memos-cloudflare) 的独立维护分支，不是 Memos 官方项目。保留上游许可证和 Git 历史。基线为上游提交 `2206732987025e4d988e5a091deb825c0013c8fa`，原前端对应 Memos v0.29.1。

## 这一版可以做什么

| 场景 | 已实现 |
| --- | --- |
| 随手记录 | 中文文字、Markdown、截图粘贴、图片拖拽、图片上传、纯图片笔记 |
| 稍后整理 | 一键添加 `#待整理`；首页全部 / 待整理 / 图片 / 置顶筛选；标签、搜索、归档 |
| 找回内容 | 中文正文、标签、日期条件、附件文件名检索；不是图片 OCR 或语义搜索 |
| 图片存储 | 原始文件写入私有 R2；D1 仅保存元数据和关联；不强制压缩、不改动图片内容 |
| 访问保护 | 新笔记默认私有；同源登录和私有图片鉴权；无默认账号密码；首次建号需要 SETUP_KEY |
| 可靠上传 | 二进制上传、实际字节数限制、服务端文件类型识别、相同上传 ID 的重试去重 |
| 数据导出 | 网页导出 JSON / Markdown；Python 脚本导出原图 + 离线 Markdown + 校验清单 |

**附件限制：** JPG、PNG、GIF、WebP、AVIF，兼容 PDF 下载；默认单文件 10 MiB，可通过 `UPLOAD_LIMIT_MB` 配置为 1–20 MiB；每条笔记最多 20 个附件。不接受 SVG/HTML，HEIC 请先转成 JPG。不提供图片转码、缩略图生成或去除 EXIF。

## 部署入口

详细操作见 **[Cloudflare 部署文档](docs/DEPLOY.md)**。首次部署需要你自己的 Cloudflare 账号、D1 数据库、R2 桶，以及两个不同的随机 Secret。

```text
notes.example.com
       ↓
Cloudflare Worker（网页 + API + 私有图片访问）
       ├── D1：正文 / 标签 / 时间 / 账号 / 附件关联
       └── 私有 R2：图片 / PDF 原文件
```

这里的域名绑定在 **Worker** 上，不是公开 R2 桶。不需要在网页里填 S3 Access Key；R2 通过 Cloudflare 绑定访问。

```bash
# Node.js 24+，npm；备份脚本需要 Python 3.10+
git clone https://github.com/lanchenglin/memos-cloudflare.git
cd memos-cloudflare
npm run setup
npm run check
npm test
npm run build
```

不要把 `JWT_SECRET`、`SETUP_KEY`、Cloudflare API Token、个人访问令牌提交到 Git，也不需要发到聊天里。仓库中的数据库 ID 是占位符，不能直接用于生产。

## 本地运行

先完成上述依赖安装与构建，然后生成 **只用于本机开发** 的随机密钥：

```bash
python3 -c 'import secrets,pathlib; p=pathlib.Path("backend/.dev.vars"); p.open("x").write("JWT_SECRET="+secrets.token_urlsafe(48)+"\nSETUP_KEY="+secrets.token_urlsafe(48)+"\n")'
cd backend
npm run db:migrate:local
npm run dev
```

浏览器访问 Wrangler 输出的本机地址。首次创建管理员时，填写 `.dev.vars` 中的 `SETUP_KEY`。文件存在时上述命令不会覆盖它。测试和本地开发只使用本地 D1/R2，不会创建远程资源。

## 测试与数据备份

`npm test` 运行后端集成测试、前端测试和备份脚本测试。后端测试使用真实 workerd 执行 Worker，模拟 D1 和 R2；不是只 Mock 数据库调用。

```bash
# 实际 Chromium 浏览器冒烟测试（不连接你的生产账户）
cd backend
npx playwright-core install chromium
npm run test:browser
# 已有 Chromium 时也可设置 CHROMIUM_PATH=/完整浏览器路径
```

浏览器测试覆盖首次初始化、图文发布、刷新、私有图片、手机宽度和离线图文备份。CI 不自动部署生产环境；完整浏览器工作流可以在 Actions 手动运行。

**[备份与迁移说明](docs/BACKUP.md)** 区分了三件事：网页导出、图文便携备份、D1/R2 整站灾备。不要把只有文字和图片链接的 JSON 当成完整原图备份。

## 范围与边界

此版优先验收个人图文记录。上游界面中的部分高级功能仍在，但 SSO、AI、语音转写、第三方客户端和多用户协作不是这一版的完整验收范围。旧 v1 接口已经移除；不能直接套用原版 Memos 的所有 REST 示例。

未保存图片仅存在当前页面，刷新前必须保存；文本草稿保存在当前浏览器，不等同云备份。R2 原图预览没有生成缩略图，大量超大图片会增加访问开销。没有启用自动 OCR、AI 自动归类、语义检索或定时整站备份。

Cloudflare 套餐、资源使用量和额度决定实际成本，本项目不承诺永久免费。首次部署建议先用非重要测试记录验证自己的域名、手机访问和备份，再导入长期资料。

许可证与安全说明：[LICENSE](LICENSE) · [SECURITY.md](SECURITY.md) · [版本说明](CHANGELOG.md)
