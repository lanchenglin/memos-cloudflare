# 随手记 · Memos Cloudflare Personal

**先记录，再整理。** 面向个人的图文笔记：一个 Cloudflare Worker 提供网页和接口，D1 保存正文、标签和账号，私有 R2 保存原图和 PDF。无需家里的电脑保持开机。

> **基于开源 Memos Cloudflare 移植版二次开发的个人图文增强分支。** 本仓库独立维护，不是 Memos 官方项目。
> 直接基于 [Allhuo/memos-cloudflare](https://github.com/Allhuo/memos-cloudflare)，原始项目为 [usememos/memos](https://github.com/usememos/memos)。沿用上游的 Cloudflare 移植架构，并针对个人记录、整理、私有图片和备份做增强。
>
> **本二开分支维护者：** [lanchenglin](https://github.com/lanchenglin) · **许可：** [MIT](LICENSE) · **来源与声明：** [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 项目来源与致谢

感谢 Memos、Allhuo 及其他上游贡献者提供的基础工作。本仓库保留直接上游 Git 历史、原有版权与许可声明，不将上游已有能力标为本分支原创。

| 来源 | 与本仓库的关系 |
| --- | --- |
| [usememos/memos](https://github.com/usememos/memos) | 原始 Memos 项目；本移植基线的前端对应 v0.29.1。已另存该版本的[原始 MIT 许可证](third_party/licenses/memos-v0.29.1-LICENSE.txt)。 |
| [Allhuo/memos-cloudflare](https://github.com/Allhuo/memos-cloudflare) | 直接二开基础，提供 Workers + D1 + R2 移植。固定基线为 [`2206732`](https://github.com/Allhuo/memos-cloudflare/commit/2206732987025e4d988e5a091deb825c0013c8fa)。 |
| [vividmuse/memos-cloudflare](https://github.com/vividmuse/memos-cloudflare) | 直接上游许可证中记载的历史来源；保留该声明，不据此推断未经核验的具体继承顺序。 |

完整的来源说明、许可证副本和校验信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [许可证索引](third_party/licenses/README.md)。

## 与上游相比，这个分支改了什么？

**Memos 的笔记基础能力，以及 Cloudflare 移植本身来自上游。** 本分支侧重以下改进，具体记录见 [CHANGELOG.md](CHANGELOG.md)：

| 方向 | 本分支的改动 |
| --- | --- |
| 随手记与稍后整理 | 更直接的图片上传入口，一键添加 `#待整理`，首页待整理 / 图片 / 置顶快捷筛选，补充附件文件名检索。 |
| 图文上传与访问 | 原始二进制上传、上传 ID 重试去重、实际字节数与格式校验、私有图片的浏览器会话访问修复。 |
| 初始化与可靠性 | 移除预置弱密码和旧 v1 路由，增加 SETUP_KEY 首次建号保护、默认关闭注册、登录限流与 R2 删除补偿队列，修复更新字段格式等问题。 |
| 导出与交付 | 个人存储统计、JSON / Markdown 导出、包含原图的便携备份和校验，补充测试、中文使用手册及 Hermes 部署任务书。 |

上表是分支差异摘要，不表示每个基础组件都由本维护者原创；测试范围见 [测试记录](docs/TEST_REPORT.md)，每个实际部署仍需独立验收。

## 文档入口

| 你要做什么 | 阅读文档 |
| --- | --- |
| 日常记录、传图、标签、搜索、整理和备份 | **[中文使用手册](docs/USER_GUIDE.md)** |
| 让 Hermes 主动配置账号资源、部署并验收 | **[Hermes 主动部署任务书](docs/HERMES_DEPLOY.md)** |
| 自己操作 Cloudflare 部署 | [人工部署说明](docs/DEPLOY.md) |
| 下载原图、校验备份、规划整站恢复 | [备份与迁移说明](docs/BACKUP.md) |
| AI 进入项目时的约定 | [AGENTS.md](AGENTS.md) |
| 了解来源、许可证和二开边界 | [来源与许可声明](THIRD_PARTY_NOTICES.md) |
| 对外分享项目、复制介绍文案 | [项目分享说明](docs/SHARING.md) |

可以直接把这段发给已有部署权限的 Hermes：

```text
请部署 https://github.com/lanchenglin/memos-cloudflare 。
先读 AGENTS.md，再完整读 docs/HERMES_DEPLOY.md，按任务书主动配置并部署。
使用现有授权的 Cloudflare、终端和浏览器权限，采用单 Worker + D1 + 私有 R2。
先检查已有资源、账号和配置，保留数据与密钥；缺少的再创建，不要只给方案。
有明确域名就绑定；没有时先交付实际 workers.dev 地址，不接管其他站点。
完成管理员初始化、真实图文验收和首次图文备份校验，凭据只安全保存到本机或密码管理器。
最后给我访问地址、用户名、密码安全保存位置、部署版本、逐项验收结果和具体待办。
```

这份任务书不会自动授予 Cloudflare 权限；Hermes 需要已有有效账号授权。它包含新部署、重复执行、旧实例升级、密钥保管、失败处理和回滚规则。仓库文档更新不代表已经完成生产部署。

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

## 许可证与分支维护

本仓库沿用 [MIT 许可证](LICENSE)。分发包含上游代码的副本时，请保留适用的版权和许可声明；本仓库同时提供了对应来源的[许可证原文副本](third_party/licenses/README.md)。第三方依赖与资源仍适用各自许可证，此处不是整个依赖树的完整许可审计。

维护者署名指本二开分支，不替代上游作者署名，不表示获得 Memos、Allhuo 或 Cloudflare 的官方背书。此分支问题请提交到[本仓库 Issues](https://github.com/lanchenglin/memos-cloudflare/issues)，不要默认要求上游为分支改动负责。

[来源与许可声明](THIRD_PARTY_NOTICES.md) · [贡献指南](CONTRIBUTING.md) · [分享文案](docs/SHARING.md) · [安全说明](SECURITY.md) · [版本说明](CHANGELOG.md)
