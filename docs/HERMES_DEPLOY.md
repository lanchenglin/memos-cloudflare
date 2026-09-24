# Hermes 主动部署任务书

仓库：`https://github.com/lanchenglin/memos-cloudflare`

目标：把个人图文笔记部署为 **单个 Cloudflare Worker + D1 + 私有 R2**，完成账号初始化、HTTPS 访问、真实图文验收和首次备份。不是仅解释部署方法，也不是只把代码推到 Git。

编写日期：2026-09-24。实现依据：0.3.0 个人图文版（功能基线 `cc60da2`）。执行时拉取当前 `main`，记录实际提交 SHA，并重新核对源码、迁移和 CLI 帮助；不要把旧测试记录当成本次生产验收。

## 0. 可直接发给 Hermes 的任务

```text
请部署 https://github.com/lanchenglin/memos-cloudflare 。
先读取仓库根目录 AGENTS.md，再完整读取 docs/HERMES_DEPLOY.md、docs/DEPLOY.md 和 docs/BACKUP.md。
我已授权你使用现有的终端、Cloudflare、GitHub 和浏览器权限，执行本项目的配置、资源创建、部署与验收。
请直接实施，不要只回复方案；能从已授权环境和现有部署记录获得的配置先自行检查，不要让我重复填写。
采用单 Worker + D1 + 私有 R2；先判断是新实例还是已有实例，保留已有数据、账号、Secret 和其他站点。
已有明确目标域名就配置并验收；没有时先使用实际 workers.dev 地址，不要猜测或接管其他业务域名。
完成首次管理员初始化、文字/多图上传、刷新后图片显示、中文搜索、私有图片匿名拒绝和图文备份校验。
密码、Token、Cookie 和备份只能安全保存在本机受限目录或密码管理器，不能进入公开 Git 或普通聊天输出。
最终交付真实访问地址、管理员用户名、密码安全保存位置、部署 SHA/版本、逐项验收结果和待办项。
只有实际缺少授权、账单开通、无法消除的账号/域名歧义或高风险数据迁移时，才报告具体阻塞；不要编造成功。
```

本文件是项目操作说明，不会给 Hermes 自动授予 Cloudflare 权限，也不替代其工具的安全审批。只在用户明确要求部署或维护本项目时执行；仅被读取不应触发生产变更。不要修改 Hermes 的全局安全策略或关闭现有审批机制。

## 1. 执行原则

1. 主动完成已授权的常规步骤；每完成一个阶段记录结果，遇到普通配置错误检查并修复后继续。
2. 所有发现、创建、迁移、Secret、部署和验证必须指向同一账号、同一 Worker、同一配置文件。不要让不同命令回落到默认账号或示例配置。
3. 不删除重建已有 D1/R2，不重置已存在的管理员，不强推 Git，不覆盖未提交代码，不因同名就复用其他项目资源。
4. 不以放开注册、公开 R2、关闭鉴权、放宽跨域或关闭 HTTPS 的方式修复失败。
5. “全部权限”只用于本项目所需操作；不购买域名、不擅自升级付费套餐、不更改其他业务 DNS、Tunnel 或安全配置。计费开通或确实需要新增付费能力时，说明具体要求。
6. 凭据发现只限当前任务已授权的环境、登录会话、密码管理器及指定凭据文件；不递归搜集整台机器的密钥，不输出完整环境变量、凭据文件或带密码的浏览器截图。

## 2. 要读取的文件与固定架构

先读：`README.md`、`backend/wrangler.toml`、根目录和 backend/frontend 的 `package.json`、`backend/migrations/` 全部文件、`docs/DEPLOY.md`、`docs/BACKUP.md`、`SECURITY.md`。

接口核对：`backend/src/index.ts`、`backend/src/security.ts`、`backend/src/personal.ts`、`backend/src/v2/services/auth.ts`、`backend/src/v2/services/user.ts`、`backend/src/v2/fileserver.ts`。

| 内容 | 本项目要求 |
| --- | --- |
| Worker | 托管静态网页、API 和受保护的图片下载 |
| D1 绑定 | 必须叫 `DB`；存正文、标签、账号、元数据 |
| R2 绑定 | 必须叫 `R2`；私有桶保存原图/PDF |
| 静态资源 | `ASSETS` → `../frontend/dist`，保留 `run_worker_first = true` |
| 部署配置 | 基于 `backend/wrangler.toml`，使用本机专用副本 |
| Secret | `JWT_SECRET`；全新实例还需要 `SETUP_KEY` |
| 网络 | 前端和接口同源；域名绑定 Worker，不绑定 R2 |
| 不需要 | 本机常驻服务、Docker、Pages 分站、Nginx、端口映射、Tunnel、应用侧 S3 Access Key |

## 3. 配置来源与无歧义默认值

以下 `MEMOS_*` 名称是本任务书给 Hermes 的部署输入约定，不是应用已实现的环境变量。Hermes 需把它们落实到配置、初始化或测试步骤；应用运行时仍按源码读取对应变量。

| 信息 | 获取顺序与缺失处理 |
| --- | --- |
| Cloudflare 凭据 | 当前授权的 API Token/密码管理器 → 有效 Wrangler 登录；缺失再执行正常登录流程 |
| `CLOUDFLARE_ACCOUNT_ID` | 明确输入 → 本项目已有部署记录 → 实际可访问且唯一的目标账号；有多个无法判定时不能随便选第一个 |
| Worker 名 | 本项目已存在实例优先；全新且无冲突时用 `memos-cloudflare` |
| D1 名 | 已验证属于本实例的数据库优先；全新且无冲突时用 `memos` |
| R2 桶 | 已验证属于本实例的私有桶优先；全新且无冲突时用 `memos-assets` |
| `MEMOS_DOMAIN` | 明确提供的域名，或本项目已有绑定；不要挪用其他项目域名。缺失时先部署 workers.dev |
| `MEMOS_ADMIN_USERNAME` | 已存在账号保留；全新实例没有偏好时可用 `owner`，记录交付 |
| 管理员密码 | 新实例生成独立随机长密码，先安全保存再创建；已有实例使用现有授权凭据，不重置 |
| `UPLOAD_LIMIT_MB` | 已有配置保留；新实例默认 `10`，有效范围 `1–20` |
| 本机状态目录 | 使用持久化的私有目录，不依赖 `/tmp` 或一次性容器 |

同名资源被其他项目使用时，**不能修改其权限或直接绑定**。全新部署可选明确的项目专属名称并记录；已经存在生产实例但归属无法确定时，停止远程写入并报告歧义。列表失败、403、超时均不代表“资源不存在”。

## 4. 阶段 A：代码和运行环境

在持久化工作目录克隆仓库。已有目录先确认 `git remote -v` 与 `git status --short`；工作区干净时才 `git pull --ff-only`。有本地修改先保存并核对，不使用 `reset --hard`。

需要 Node.js 24+、npm、Python 3.10+（推荐 3.11+）。优先使用现有用户级 Node 安装。Hermes 的非登录 shell 找不到 npm 时，检查 PATH 或加载已有 nvm，不要误判为代码问题。

在仓库根目录执行：

```bash
set -euo pipefail
set +x
umask 077
export REPO_DIR="$(pwd -P)"
export STATE_DIR="$HOME/.local/state/memos-cloudflare/deploy"
mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
node --version
npm --version
python3 --version
git rev-parse HEAD
npm run setup
npm run check
npm test
npm run build
```

`npm run setup` 使用两个 npm 锁文件安装。不要擅自改成 pnpm，不执行 `npm audit fix --force`，也不为绕过构建失败全量升级依赖。测试失败先定位原因，不删除测试来“修复”。

有浏览器运行条件时，再执行仓库自带 `npm run test:browser`；首次需要在 backend 安装 Playwright Chromium 或设置有效 `CHROMIUM_PATH`。该测试启动本地模拟环境，**不验收生产地址**。

## 5. 阶段 B：固定本机配置和鉴权

创建 `backend/wrangler.hermes.toml`，首次从 `backend/wrangler.toml` 复制；已有副本不覆盖，先与当前模板比较需要保留的新字段。把副本路径加入本仓库 `.git/info/exclude`，用 `git check-ignore` 验证忽略生效。不要将生产配置写回公开模板。

此副本放在 backend 下是为了保持 `main`、`assets.directory`、`migrations_dir` 的相对路径正确。状态记录和凭据则保存到仓库外的 `$STATE_DIR`；文件权限为 600。

下面约定使用 Bash，在 backend 目录统一定义命令：

```bash
cd "$REPO_DIR/backend"
WR=("$REPO_DIR/backend/node_modules/.bin/wrangler" --config "$REPO_DIR/backend/wrangler.hermes.toml")
"${WR[@]}" --version
"${WR[@]}" whoami
"${WR[@]}" d1 list
"${WR[@]}" r2 bucket list
```

每次 Hermes 开新 shell，都要恢复 `REPO_DIR`、`STATE_DIR`、`WR` 和已选定的账号；不要假定前一工具调用的 shell 变量还存在。可写本机受限的无密钥环境文件，或使用绝对路径重复构造命令。

优先用已授权的 `CLOUDFLARE_API_TOKEN` 和明确的 `CLOUDFLARE_ACCOUNT_ID`。没有有效登录再调用 Wrangler 正常登录；浏览器确认、验证码或账单开通确需本人完成时，给出具体动作，不反复盲试。**本机 sudo/GitHub 权限不等于 Cloudflare API 权限。**

权限必须覆盖当前账号所需的 Workers 发布/Secret、D1、R2；绑定域名时还需对应 Zone 和 Worker 域名/路由操作能力。以平台返回的权限错误和当前官方文档为准，不要求用户公开发送全局 API Key。

使用项目内已安装的 Wrangler，不运行 `wrangler@latest`。命令参数不匹配时先查看该版本 `--help`；不要猜测新参数。不要使用无上限 `yes | ...` 掩盖账号、创建或覆盖提示。

## 6. 阶段 C：检查或创建 D1/R2

### C1. 先发现，后创建

检查当前账号的目标 Worker、D1、R2 和本机部署记录。确认资源不存在且属于全新部署时，才创建：

```bash
# 在 backend；D1_NAME、R2_BUCKET 必须先按第 3 节解析并校验，不能为空。
"${WR[@]}" d1 create "$D1_NAME"
"${WR[@]}" r2 bucket create "$R2_BUCKET"
```

把真实数据库 ID、资源名和已确认的账号 ID写入本机配置副本。保留绑定名 `DB`/`R2`，保留静态资源、兼容日期和迁移目录。`00000000-0000-0000-0000-000000000000` 绝不能留在生产配置。

不要把同名作为唯一归属证据。平台/CLI 自动建议创建资源时先核对计划，不能因此出现第二套误绑定的库或桶。

### C2. 核对数据库状态

```bash
"${WR[@]}" d1 execute DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
"${WR[@]}" d1 migrations list DB --remote
```

- 无业务表的新库：可执行仓库迁移。
- 已有本项目正常迁移记录：走升级路径，先备份，再只应用未执行迁移。
- 已有业务表但无相应迁移记录、原版 Memos/旧社区版库、或结构不符：先备份和评估，**不直接套 0001，不伪造迁移记录，不清空库**。

当前 0.3.0 包含 `0001_v2.sql` 和 `0002_personal.sql`。不要只执行 `schema-v2.sql`；它不能代替完整迁移。以后新增迁移也应逐个读过。

### C3. 确认桶私有

```bash
"${WR[@]}" r2 bucket dev-url get "$R2_BUCKET"
"${WR[@]}" r2 bucket domain list "$R2_BUCKET"
```

本实例的桶必须没有有效公共访问：r2.dev 禁用，没有对公众提供对象的桶域名。不配置通配 CORS，不把 R2 公网地址写进图片 URL。新私有桶不需要额外 S3 凭据才能供 Worker 使用。

发现公共桶时先确认是否为其他业务。不能为了部署笔记而关闭别人的图床；若确为本项目且用户目的为私有化，可关闭公共入口并验证。权限不足以检查时，报告“私有状态未验证”，不能写成已通过。

## 7. 阶段 D：Secret 与数据库迁移

### D1. 新实例与升级的区别

先列出目标 Worker 的 Secret **名称**，不读取或打印值。Worker 尚未存在时该命令可能失败，应根据具体错误区分不存在与鉴权失败。

```bash
"${WR[@]}" secret list
```

全新实例且不存在生产 Secret 时，生成不同的 `JWT_SECRET` 和 `SETUP_KEY`。示例只在已确认的新部署运行；先保存到私有状态目录，不打印值：

```bash
python3 - <<'PY'
import json, os, secrets
from pathlib import Path
path = Path(os.environ['STATE_DIR']) / 'bootstrap-secrets.json'
if path.exists():
    raise SystemExit('文件已存在：先核对是否为本次实例，禁止覆盖或盲目轮换。')
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump({'JWT_SECRET': secrets.token_urlsafe(48),
               'SETUP_KEY': secrets.token_urlsafe(48)}, f)
print('随机密钥已写入私有文件，未输出密钥内容。')
PY
```

随后通过文件输入上传，不把真实值放进命令行参数：

```bash
"${WR[@]}" secret bulk "$STATE_DIR/bootstrap-secrets.json"
"${WR[@]}" secret list
```

CLI 要求创建同名空 Worker 时，仅在已核对目标为全新实例后完成该提示。若该版本无法直接建立空 Worker，可先按 D2 完成迁移，再部署**当前已审查版本**创建 Worker，然后立即配置 Secret。当前实现中，没有有效 JWT_SECRET 时写请求返回 503，缺少 SETUP_KEY 时首次建号被拒绝；依然不得把这种中间状态当部署成功。不要用旧弱密码版本作过渡。

**已有实例：保留现有 JWT_SECRET，即使本机读不到旧值也不能随机覆盖。** 重设会使已有凭据失效；已有管理员时也不要重新添加 SETUP_KEY。只有明确的密钥轮换/恢复任务才走单独流程。

`secret bulk` 和 `secret put/delete` 可能立即产生新部署，已有生产实例要记录前后版本；不要把它们当成仅修改本地文件。

### D2. 执行迁移

新库或已确认可安全升级并完成备份时，运行：

```bash
# DB 是绑定名，避免数据库改名后 npm 脚本仍指向示例 memos。
CI=true "${WR[@]}" d1 migrations apply DB --remote
"${WR[@]}" d1 migrations list DB --remote
"${WR[@]}" d1 execute DB --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

`CI=true` 只在已读过待执行 SQL、账号和数据库均确认时使用。迁移失败就诊断，不继续部署后声称可用。检查 `user`、`memo`、`attachment`、`auth_throttle`、`r2_deletion_queue` 等当前版本所需表。

## 8. 阶段 E：发布 Worker 和绑定域名

先检查本机配置：正确的资源 ID；`BASE_URL` 默认空；上传限制正常；同源前端未设置错误的 `VITE_API_BASE_URL`；没有密钥混入普通 vars。

```bash
cd "$REPO_DIR"
npm run build
cd "$REPO_DIR/backend"
"${WR[@]}" deploy --dry-run --outdir dist
"${WR[@]}" deploy
```

**不要在使用专用配置时直接跑根目录 `npm run deploy` 或 `npm run db:migrate:remote --prefix backend`。** 这些已有脚本默认读取原模板/示例数据库；本任务必须通过 `WR` 命令使用正确副本。

记录真实返回的地址和部署版本。`/health` 仅说明应用能响应，不验证数据库、登录或 R2；必须继续后续步骤。

### 自定义域名

有明确目标域名时，检查该 Zone 属于所选账号，并确认目标主机名没有其他站点、Tunnel 或冲突 DNS。配置副本可以添加：

```toml
[[routes]]
pattern = "notes.example.com"
custom_domain = true
```

这里必须替换成**已确定的实际域名**，不是照抄示例。该配置是 Worker Custom Domain，不是 `r2 bucket domain add`。不要盲删已有 DNS 解决冲突。

首次验证期间，可在配置文件**顶层、任何 TOML 表之前**明确设置 `workers_dev = true`、`preview_urls = false`。自定义域名通过完整验收后，需要只保留正式入口时改为 `workers_dev = false` 并重新部署。不要只在控制台改完却让下次 Wrangler 又恢复旧入口。

没有明确域名时，用部署实际返回的 workers.dev 地址继续初始化和验收，报告“自定义域名待配置”。如果账号连 workers.dev 子域也没有且当前工具无法无歧义创建，只报告这一具体阻塞；不要编造访问地址。

始终在最终使用的同一域名完成登录和图片验收；两个域名不共享浏览器 Cookie。TLS 证书尚未就绪时不得关闭 HTTPS，保留真实状态。

## 9. 阶段 F：主动创建首个管理员

本步骤必须直接实施，不能以“用户自己打开网页注册”替代全部交付；但已存在管理员时跳过创建，使用其现有授权凭据验收。

先调用 `InstanceService/GetInstanceProfile` 检查返回的 `admin`，并与 D1 的用户数量核对。若用户已存在但状态不正常，不按全新实例处理。

全新实例：生成独立随机长密码（例如 `secrets.token_urlsafe(24)`），使用第 3 节选定用户名。先把用户名、站点和密码写入仓库外的受限文件（例如 `$STATE_DIR/owner.json`，权限 600）或密码管理器。文件已存在时核对并复用，不覆盖。**此密码不得与 JWT_SECRET/SETUP_KEY 共用。**

可以用浏览器填写首次页面；也可用 Python/Node 在内存中读取受限凭据文件，直接调用下面已实现的 Connect JSON 接口。不要使用旧 `/api/auth/signup` 等已移除接口。

| 操作 | POST 路径 | JSON 请求 |
| --- | --- | --- |
| 实例状态 | `/memos.api.v1.InstanceService/GetInstanceProfile` | `{}` |
| 首次建号 | `/memos.api.v1.UserService/CreateUser` | `{"user":{"username":"<选定用户名>","password":"<运行时读取的密码>"}}` |
| 登录 | `/memos.api.v1.AuthService/SignIn` | `{"passwordCredentials":{"username":"<选定用户名>","password":"<运行时读取的密码>"}}` |
| 当前用户 | `/memos.api.v1.AuthService/GetCurrentUser` | `{}` |

请求头使用 `Content-Type: application/json`、`Connect-Protocol-Version: 1`。首次建号额外带 `X-Setup-Key`。登录返回 `accessToken` 和会话 Cookie；后续 API 使用 `Authorization: Bearer <token>`，只在进程内构造，不记录请求头或完整登录响应。浏览器原生图片加载还要验证实际 Cookie 链路，不能只拿 API token 下载一次就算通过。

请求必须发到已验证的 HTTPS 原站，不允许跟随把凭据转发到其他域名的重定向。初始化冲突时重新读状态，不重复创建、不清空用户表。

确认角色为 ADMIN、已登录且账号凭据已妥善交付后，删除远端 SETUP_KEY：

```bash
"${WR[@]}" secret delete SETUP_KEY
"${WR[@]}" secret list
```

这可能再次发布版本，所以要重新验证站点并记录最终版本。安全保存 JWT_SECRET 的灾备副本；本机 Secret 文件中的 SETUP_KEY 可清除，或明确标记“已从远端撤销”。升级时不要再次上传含旧 SETUP_KEY 的整份文件。

## 10. 阶段 G：真实站点验收清单

使用合成文字和非敏感测试图片，不上传用户已有私人相册或文档。测试记录带唯一前缀，例如 `部署验收-<时间>-<随机串>`；清理时只处理本次创建且已记录 ID 的内容。

| 必测项 | 通过标准 |
| --- | --- |
| 页面与健康接口 | HTTPS 首页正常；`GET /health` 返回应用 JSON，不是 SPA HTML |
| 数据库与登录 | 实例接口正常；能登录、读当前用户，首个账号角色正确 |
| 文字笔记 | 创建带中文、链接、标签的 PRIVATE 笔记，刷新后存在 |
| 图片 | 纯图片、多图、中文文件名均上传成功，并在页面渲染 |
| 保存后刷新 | 完整刷新和重新登录后，已保存私有图片仍显示 |
| 编辑与组织 | 修改正文、置顶/取消置顶、归档/查找归档可以完成 |
| 搜索 | 中文正文和已关联附件文件名可检索；清除筛选后结果正确 |
| 待整理 | 添加 `#待整理` 后进入筛选，删除该标签并保存后退出 |
| 私有附件 | 新的无痕浏览器、不带 Cookie/Authorization 访问私有图片被拒绝，不能返回图片内容 |
| 私有正文 | 匿名列表/详情不泄露测试 PRIVATE 笔记 |
| R2 权限 | 控制面确认桶非公开；不能只测 Worker 入口而漏掉公共桶旁路 |
| 手机布局 | 窄屏无明显横向溢出，上传入口、保存和预览可用；区分模拟窄屏与真实手机测试 |
| 备份 | G 后按 H 生成图文备份并校验至少一个真实附件的内容哈希 |
| 最终入口 | Secret 撤销/域名切换后的最终版本仍通过登录和图文测试 |

可以复用 `backend/tests/browser-smoke.mjs` 的测试思路，但它现有实现是本地 Miniflare 测试，**不能直接宣称它测了生产**。需要针对真实域名建立独立的临时测试脚本或浏览器操作，脚本从受限文件/环境读取凭据。

不能仅看 HTTP 200：检查 Content-Type 和响应 JSON；未知 API 路径不应被 HTML 首页冒充成功。不要通过把笔记改为 PUBLIC 来让图片测试变绿。

有浏览器工具就执行真实页面测试；没有时完成 API 验证并明确记录“浏览器上传/刷新/手机未验证”。不得把 API 成功冒充 UI 成功。对限流不做高频暴力试错，保留故障记录。

## 11. 阶段 H：首次备份与长期运行

### H1. 本次至少完成图文便携备份

从当前登录会话获得短期访问令牌，或创建有期限的个人访问令牌。通过子进程环境传入 `MEMOS_TOKEN`，不要硬编码。先暂停修改，备份路径放在仓库外的持久化私有目录，不能覆盖已有目录。

```bash
cd "$REPO_DIR"
# MEMOS_TOKEN 由已授权凭据流程安全注入，不能 echo；BACKUP_DIR 为本次唯一目录。
python3 scripts/backup.py backup --url "$BASE_URL" --output "$BACKUP_DIR"
python3 scripts/backup.py verify --directory "$BACKUP_DIR"
unset MEMOS_TOKEN
```

这里 shell 的 `BASE_URL` 必须是已经验收的实际 HTTPS 地址，**不是** wrangler vars 中建议留空的 `BASE_URL`。检查 `manifest.json`、Markdown 和原图都存在。使用浏览器创建的真实测试图核对下载字节/哈希；若笔记数量为零或没有附件，不得声称已经验收图文备份。

原图仍保留 EXIF；备份也是私人数据。权限限制之外，按现有条件使用加密磁盘或密码管理的加密归档。不把备份、Cookie、令牌、包含私有内容的截图/浏览器 trace 提交公开仓库。

### H2. 整站灾备单独记录

图文便携备份不包含账号、系统设置、未关联文件，也没有自动导回本实例的恢复命令。完整灾备还需要 D1 SQL 与 R2 原 object key 的副本、部署配置、独立保管的 Secret。

已有实例升级前必须完成整站备份，并在有数据写入时安排暂停写入/清理或一致性策略。D1 示例：

```bash
"${WR[@]}" d1 export DB --remote --output "$STATE_DIR/d1-before-upgrade-<唯一时间>.sql"
```

将示例唯一时间替换为本次值。R2 用已经授权的受限 S3 凭据和兼容工具复制到第二份存储，保留对象键；不用会删除目标数据的同步参数。无备份目标或数据访问凭据时，具体报告缺什么，不把网页导出当灾备。

全新实例也记录灾备是否配置。具备明确备份位置和权限时可完成首份整站副本；否则将其列为长期使用前待办。**不要自动开通新收费备份服务。**

定时备份只有在已建立持久化执行环境、明确存储目标并实际配置调度后才能写“已启用”。本项目内置 Cron 仅清理过期会话和 R2 删除队列，不备份数据；在会休眠的 WSL 上配置计划也不能保证全天执行。

## 12. 升级、失败恢复和重复执行

重复执行必须先读本机 `deployment.json`/报告与远端实际状态，保留同一账号、资源 ID、域名和 JWT_SECRET。不是重新跑一遍资源创建和首个用户注册。

升级顺序：保存当前 Git SHA、Worker 版本/绑定/域名 → 暂停必要写入并备份 D1/R2 → 拉取并检查新代码/迁移 → 本地测试与构建 → 应用已审查的兼容迁移 → 部署 → 真实验收。清理调度如被临时停用，必须记录并恢复。

普通错误按具体信息处理；401/403 不当成资源不存在，SQL 报错不通过删表解决，图片错误不通过公开桶解决。

Worker 代码回滚可使用当前 Wrangler 的 `rollback <已记录的版本ID>`；执行前检查该版本与现在的 D1 结构、绑定和 Secret 是否兼容。**Worker 版本回滚不是数据库或 R2 回滚，也不是 Git 回滚。** 不回滚到没有有效 Secret 的初始化版本，不执行未知的数据逆向迁移。

需要恢复数据时，先在新建隔离 D1/私有 R2 和独立 Worker 中恢复并验收，再切换入口。不要在原生产库上试错导入。第一次部署失败而没有可回滚版本时，保留已建立的数据资源和受限记录，报告最后通过阶段，不为“清理现场”删库删桶。

## 13. 最终交付报告

在仓库外私有目录保存 `deployment.json` 或 `DEPLOYMENT_REPORT.md`，至少包含：

```text
总体状态：PASS / PARTIAL / BLOCKED
执行时间与时区：
源码仓库、分支、实际 Git SHA：
目标账号（报告中适当脱敏）：
Worker 名称、最终部署/版本 ID：
真实 HTTPS 地址：
自定义域名 / workers.dev / preview_urls 状态：
D1 名、ID、实际迁移结果：
R2 桶名、绑定、公共访问检查：
管理员用户名：
密码安全保存位置（不是密码值）：
JWT_SECRET 是否存在；SETUP_KEY 是否已撤销：
实际上传限制：
本次验收逐项 PASS / FAIL / NOT_RUN：
备份路径、笔记/附件数量、verify 结果：
整站灾备 / 定时备份 / 恢复演练是否真的完成：
修改或创建过的资源清单：
回滚依据、剩余问题、需要用户处理的最小阻塞：
```

对外回复只展示必要摘要和安全文件位置，不展示 Secret、Token、Cookie、密码、密码哈希或完整私人备份。缺少目标域名不影响交付已验证的 workers.dev 入口，但必须说清楚；登录、R2 私有化或实际图文验收未通过则不能报完整 PASS。

仓库已有 `docs/TEST_REPORT.md` 是代码开发阶段的测试报告，不改写成不存在的生产测试。若部署中修复了通用代码问题，先测试并仅提交无凭据的代码/文档；不要把生产配置、部署报告和测试数据顺手 `git add .`。

## 14. 官方参考与核对优先级

本任务书给出的是本项目操作顺序；接口字段以当前源码为准，CLI 参数以项目锁定版本的 `--help` 和官方文档为准。旧的 Pages/前后端分离说明不适用于本个人版。

- [Cloudflare：Wrangler 命令](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Cloudflare：Workers 发布、Secret、回滚](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- [Cloudflare：D1 命令与迁移](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare：R2 命令与公共入口检查](https://developers.cloudflare.com/r2/reference/wrangler-commands/)
- [Cloudflare：Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare：Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare：workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Hermes：项目上下文文件](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files/)

给日常使用者的文档：[USER_GUIDE.md](USER_GUIDE.md)。
