# ywdj：独立部署与 Hermes 执行任务书

本文件仅适用于 `lanchenglin/memos-cloudflare` 的 **ywdj 分支**。读取文档不代表获得生产部署授权；只有用户明确要求部署、升级或维护该实例时才执行远程资源变更。

## 1. 不与个人随手记混用

`main` 保持个人笔记版；`ywdj` 为应用侧提交锁定的运维登记版。不要把 ywdj 直接发布到现有随手记站点，不要复用个人笔记的 D1/R2。新建独立 Worker、D1 和私有 R2；已有 ywdj 实例则核对归属后原地升级并保留账号、数据和 JWT_SECRET。

建议新实例名称：Worker `memos-ywdj`、D1 `memos-ywdj`、R2 `memos-ywdj-assets`。名称冲突时先查归属，不能删除或占用别人资源。域名由用户指定；没有域名时使用本实例实际 workers.dev 地址，不挪用其他站点 DNS。

第一版是单团队共享：所有启用的成员可以查阅本实例正式记录和证据。没有部门/项目级权限隔离；不能开放自助注册，不公开 R2。

## 2. 给 Hermes 的任务

```text
请部署 lanchenglin/memos-cloudflare 的 ywdj 分支（不是 main）。
先读取 AGENTS.md、docs/YWDJ_REQUIREMENTS.md 和完整 docs/YWDJ_DEPLOY.md。
本次是运维登记版：当天登记、提交锁定、追加更正、事故关联、正式附件锁定。
仅在已有授权范围内主动完成部署与验证；不要修改 Hermes 的安全审批设置。
采用独立单 Worker + D1 + 私有 R2，不覆盖现有个人随手记和其他站点。
先核对账号、资源归属、工作区状态与 Git SHA；缺少资源再创建，已有 ywdj 数据先备份。
使用用户级 Node.js 24+，保留 lockfile，用本机专用配置贯穿构建、迁移、Secret、部署和验证。
新实例默认业务时区 Asia/Shanghai；不要依据访问者浏览器时区设定“今天”。
完成管理员初始化、添加普通成员，分别测试权限、登记、跨天追加、附件、查询、导出和便携备份。
密码和令牌安全保存，不提交 Git、不打印到聊天或普通日志。
最终报告真实地址、ywdj Git SHA、Worker 版本、业务时区、账号名、密码存放位置和逐项验收结果。
发现缺权限、计费开通、资源归属歧义或迁移风险时停止对应远程写入，准确报告阻塞，不能假报成功。
```

## 3. 本地开发与自动测试

使用新的工作目录或已确认没有未提交改动的 ywdj 工作区，禁止 `reset --hard` 和强推。

```bash
git clone --branch ywdj --single-branch https://github.com/lanchenglin/memos-cloudflare.git memos-ywdj
cd memos-ywdj
node --version                 # 要求 24+
python3 --version              # 便携备份要求 3.10+
npm run setup                 # 使用锁定依赖
npm run check
npm test
npm run build
npm run build:check --prefix backend

# 真实浏览器验收，本地临时 D1/R2；不会访问生产账号。
cd backend
npx playwright-core install chromium
npm run test:browser
```

已有 Chromium 可设置 `CHROMIUM_PATH` 到实际可执行文件。浏览器测试包含普通成员、管理员、提交后更正、原图刷新、按日期/附件名查询、JSON 导出、断网丢失响应后的幂等重试、320/390 像素布局，以及新备份脚本原图校验。`npm run test:mobile` 是保留的个人版组件手势回归，不替代 ywdj 的真实入口测试。

本机预览先从仓库根目录创建仅本机使用的独立 Secret 文件，已存在时不覆盖：

```bash
python3 - <<'PY'
import pathlib, secrets
p = pathlib.Path('backend/.dev.vars')
p.open('x').write('JWT_SECRET=' + secrets.token_urlsafe(48) + '\nSETUP_KEY=' + secrets.token_urlsafe(48) + '\n')
p.chmod(0o600)
PY
cd backend
npm run db:migrate:local
npm run dev
```

不要部署 `tests/fixtures/personal-worker.ts`。正式入口必须是 `backend/src/index.ts`；它固定启用审计版，不能通过请求参数或页面设置关闭。

## 4. 配置实际 Cloudflare 资源

部署前确认用户明确授权、目标 Cloudflare 账号和资源归属。优先使用已有安全登录/令牌，不打印环境变量或递归搜索整台机器密钥。每条命令使用同一个账号和专用配置文件；不能列表失败就断言资源不存在。

仓库 `backend/wrangler.toml` 是占位模板。D1 全零 UUID 不是可用资源，不要直接远程部署。先用当前安装 Wrangler 的 `--help` 核对命令，再查询或创建归属明确的独立资源。

专用配置建议放在仓库外私有目录，文件权限 600。配置在仓库外时必须把路径改为绝对路径，避免 Worker 入口、静态文件、迁移目录解析错误。

```bash
# 在仓库根目录；仅准备本地配置，不创建远程资源。
set -euo pipefail
set +x
umask 077
export YWDJ_REPO="$(pwd -P)"
export YWDJ_STATE="$HOME/.local/state/ywdj"
export YWDJ_CONFIG="$YWDJ_STATE/wrangler.toml"
mkdir -p "$YWDJ_STATE"
chmod 700 "$YWDJ_STATE"
python3 - <<'PY'
import os, pathlib
root = pathlib.Path(os.environ['YWDJ_REPO'])
config = pathlib.Path(os.environ['YWDJ_CONFIG'])
text = (root/'backend/wrangler.toml').read_text()
text = text.replace('main = "src/index.ts"', f'main = "{root}/backend/src/index.ts"')
text = text.replace('directory = "../frontend/dist"', f'directory = "{root}/frontend/dist"')
text = text.replace('migrations_dir = "migrations"', f'migrations_dir = "{root}/backend/migrations"')
config.open('x').write(text)  # 已存在则停止，不能覆盖原部署配置
config.chmod(0o600)
PY
```

将实际账号 ID、D1 ID、Worker/数据库/桶名称写入这份配置。保持绑定名 `DB`、`R2`、`ASSETS`，保持静态资源 `run_worker_first = true`。业务时区默认 `AUDIT_TIMEZONE = "Asia/Shanghai"`；第一次写入正式记录后不要随意变更。

在 backend 目录使用本项目安装的 Wrangler 操作。以下远程命令仅供已授权部署时执行，`memos-ywdj` 必须替换为专用配置中的真实数据库名：

```bash
cd "$YWDJ_REPO/backend"
npx wrangler d1 migrations apply memos-ywdj --remote --config "$YWDJ_CONFIG"
npx wrangler secret put JWT_SECRET --config "$YWDJ_CONFIG"
npx wrangler secret put SETUP_KEY --config "$YWDJ_CONFIG"
npx wrangler deploy --config "$YWDJ_CONFIG"
```

两个 Secret 使用不同的高强度随机值，只在新实例缺失时设置。已有 ywdj 升级不要重新生成 JWT_SECRET 或重置管理员。全部迁移按序执行 0001、0002、0003；让 Wrangler 管理迁移记录，不手工伪造已应用状态。

D1/R2 管理员权限和不可变保留锁不属于此版任务，不必为它们改云账户策略。应用仍需正常鉴权和私有附件访问，不能通过公开桶、放宽 CORS 或开放旧 API 修复报错。

## 5. 实际站点验收

先用非敏感测试记录验证。正式提交的测试记录本来也不能删除，命名应明确“验收测试”，必要时管理员追加作废说明。不要在生产数据库里直接清理来掩盖应用测试结果。

| 验收项 | 应达到的结果 |
|---|---|
| `/health` | `service: memos-ywdj`；记录真实 Worker 版本和 Git SHA |
| 初始化与登录 | 首个管理员需要 SETUP_KEY；之后普通访客无法注册 |
| 普通账号创建 | 管理员添加，普通账号无法创建其他成员 |
| 当天登记 | 服务器登记时间和登记人；篡改客户端日期/作者字段被拒绝 |
| 已提交正文 | 普通成员和管理员 PATCH/PUT/DELETE 均被拒绝 |
| 证据附件 | 提交后不能覆盖/删除；匿名不能读，启用的团队成员可读 |
| 追加更正 | 新记录关联原事故/目标记录；原文保留 |
| 跨天处置 | 原事故允许今天的新增进展；不倒填昨天登记时间 |
| 日查询和事故链 | 历史日期可查，全链显示跨天内容，分页完整 |
| 账号停用 | 会话失效，既有记录和登记人快照保留 |
| 导出 | 全部匹配页，明确不是只有当前页，也不是原图备份 |
| 原图备份 | 使用下面的新脚本下载原件并校验，不能用个人版 backup.py |
| 手机 | 至少检查 390 像素宽度，表单/附件/事故编号不横向溢出 |

## 6. 便携备份

`MEMOS_TOKEN` 使用当前启用账号的有效访问令牌，通过安全环境注入；不要放进命令行、仓库、文档样例或截图。普通成员能备份全部团队正式记录，但系统审计日志只有管理员可备份。

```bash
python3 scripts/audit_backup.py backup --url https://你的登记域名 --output /安全目录/ywdj-首次备份
python3 scripts/audit_backup.py verify --directory /安全目录/ywdj-首次备份
```

目录必须是新的。成功时包含 `records.json`、`audit-log.json`、原始附件和 `manifest.json`。输出最终 complete 清单之前失败代表不完整，修复后使用新目录重试。校验失败不得声称备份成功。

此脚本不包含账号凭据、全部系统配置、未提交附件或旧个人笔记；也没有自动恢复和定时整站备份。整站灾备仍需独立保留 D1、R2 和配置，并另行演练恢复。

## 7. 升级与回退

升级前备份现有 ywdj 正式记录/附件和整站资源，保存配置与当前 Git/Worker 版本。只应用尚未应用的迁移，不删表重建。回退只能回到兼容审计数据和当前 schema 的 ywdj 版本，不能直接用 main 的个人版入口替换审计版。即使 main 不读审计表，也不应把可写个人 UI 暴露为审计系统。

最终交付说明中逐项标为 PASS / FAIL / NOT_RUN，区分本地模拟通过、生产实际通过和未验证事项。没有线上部署的访问地址不能编造。本分支实现不意味着现有站点自动更新。
