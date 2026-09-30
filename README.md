# 运维登记 · ywdj

**当天登记，提交锁定；写错追加更正，事故沿时间线追溯。**

这是 `lanchenglin/memos-cloudflare` 的 **ywdj 长期分支**。`main` 保持个人随手记；本分支面向运维告警、事故初报、操作记录、恢复确认和复盘。只约束应用侧，不涉及数据库管理员权限治理。

> 基于 [Allhuo/memos-cloudflare](https://github.com/Allhuo/memos-cloudflare) 二次开发，原始项目为 [usememos/memos](https://github.com/usememos/memos)。不是 Memos 官方发行版。保留上游 Git 历史、MIT 许可与版权声明，详见 [来源与声明](THIRD_PARTY_NOTICES.md)。维护者：[lanchenglin](https://github.com/lanchenglin)。

## 使用规则

普通成员可以新增**业务时区当天**记录，但正式提交后无法修改、删除、倒填日期或移除原附件。管理员同样不能直接修改/删除正式记录，能追加带原因的作废说明。更正、后续处置、恢复和复盘都作为新记录关联到原事故，原文始终保留。

登记时间由服务器生成，登记人来自登录账号并保留当时身份快照。默认业务时区 `Asia/Shanghai`。跨天事故可以在今天新增进展，但不能假装成昨天已经登记。

**访问范围：第一版为单团队共享。所有启用的登录成员可以查询本实例全部正式记录和附件。** 不支持部门/项目隔离，不开放普通访客注册；请使用独立实例，不混入私人笔记。

## 已实现的第一版

| 能力 | 说明 |
|---|---|
| 运维登记 | 告警、事故初报、处置/操作、恢复、复盘、更正、作废说明 |
| 提交锁定 | 后端拒绝正文/日期修改、删除、旧笔记接口和删除用户级联；不只是隐藏按钮 |
| 证据附件 | 私有 R2 保存原始图片/PDF；正式关联后不可删改；保存 SHA-256 和字节数 |
| 当天与历史 | 今天新增，历史按日查看；完整事故链展示跨天追加及真实登记时间 |
| 搜索 | 登记/发生日期、系统、登记人、类型、程度、中文正文、编号、附件名 |
| 重试可靠性 | 请求编号去重，原请求先保存；丢失响应后刷新/重试不重复入库 |
| 账号管理 | 管理员添加/停用/启用成员；停用保留历史；支持本人修改密码 |
| 操作审计 | 记录登记、附件、导出、账户变更及关键被拒绝操作；仅管理员可查 |
| 导出备份 | 全查询分页 JSON 导出；独立脚本备份原附件并校验 |
| 手机界面 | 独立登记页面，响应式布局；实际验收范围见测试报告 |

未做：历史补录审批、多团队权限、自动采集告警、AI 根因分析、定时整站灾备、自动恢复、数据库级防篡改或合规认证。

## 文档

- [需求、边界和实现约定](docs/YWDJ_REQUIREMENTS.md)
- [部署 / 本地开发 / Hermes 任务书 / 备份](docs/YWDJ_DEPLOY.md)
- [本次实际测试报告](docs/YWDJ_TEST_REPORT.md)

源码入口：后端 `backend/src/audit/`，前端 `frontend/src/audit/` 和 `frontend/src/pages/Audit.tsx`，迁移 `backend/migrations/0003_ywdj.sql`。生产 Worker 入口固定为 `backend/src/index.ts`。

## 开发与检查

```bash
git clone --branch ywdj --single-branch https://github.com/lanchenglin/memos-cloudflare.git memos-ywdj
cd memos-ywdj
# Node.js 24+、Python 3.10+
npm run setup
npm run check
npm test
npm run build
npm run build:check --prefix backend
# 已安装 Chromium 后：
npm run test:browser
```

后端保留的个人版测试使用专门的测试入口；这不是运行时可关闭审计规则的开关。真实审计入口由独立的后端与浏览器测试覆盖。

## 部署与数据提醒

采用单 Worker + D1 + 私有 R2，给 ywdj 分配独立 Worker、数据库、桶和访问地址。不要直接覆盖已有个人随手记。仓库 Wrangler 配置中的 D1 ID 是占位符，必须使用已核实的本机专用配置；密码/Token/生产配置不能提交 Git。

网页导出的 JSON 不包含原始图片/PDF。原件便携备份使用 `scripts/audit_backup.py`，令牌通过 `MEMOS_TOKEN` 安全环境提供。它不等于 D1/R2 全站灾备，不自动备份或恢复。

仅创建/更新分支不会自动部署你的 Cloudflare 站点。测试报告会明确区分本地通过和线上未验证。

## 来源和许可证

直接上游 Allhuo Cloudflare 移植基线及原始 Memos 的许可证继续保留。本分支从个人版 `0383b3ee90acdda3b60c7b011ba0dd668ad62fbe` 分出，新增运维登记业务，不将上游基础能力标为从零原创。许可证为 [MIT](LICENSE)，更多来源信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [许可证索引](third_party/licenses/README.md)。
