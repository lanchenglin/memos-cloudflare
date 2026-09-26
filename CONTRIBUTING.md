# 贡献指南 / Contributing Guide

感谢关注 **随手记 · Memos Cloudflare Personal**。本仓库是由 lanchenglin 维护的二开分支，直接基于 Allhuo/memos-cloudflare，原项目为 Memos。完整来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 中文

### 报告问题和提出改进

请在[本仓库 Issues](https://github.com/lanchenglin/memos-cloudflare/issues)报告这个分支的问题。说明实际 Git SHA / 版本、部署方式、浏览器、复现步骤、预期结果与实际结果。粘贴日志前删去密码、Token、Cookie、Secret、个人笔记和其他私人内容。

此分支侧重图文记录、搜索整理、私有图片、备份和部署可靠性。提出大范围架构调整前，先描述需求与取舍。除非确认问题来自未修改的上游版本，否则不要默认把分支缺陷转给上游维护者处理。

安全问题请先阅读 [SECURITY.md](SECURITY.md)，不要在公开 issue 中上传真实密钥、私人数据或可直接滥用的生产信息。

### 开发与验证

使用当前 npm 锁文件；Node.js 24+，Python 3.10+（推荐 3.11+）。在仓库根目录：

```bash
npm run setup
npm run check
npm test
npm run build
```

本地开发初始化、密钥与数据库迁移按 [README](README.md) 和 [部署说明](docs/DEPLOY.md)操作，只使用隔离本地 D1/R2。需要浏览器测试时，按 README 安装 Chromium，再运行 `npm run test:browser`；该命令测试本地模拟环境，不验收生产实例。

### 提交修改

从自己的 fork 建立功能分支，提交针对性修改和测试，向[本仓库](https://github.com/lanchenglin/memos-cloudflare/pulls)提交 PR。描述问题、修改范围、验证命令、兼容性及数据库迁移影响；提交信息可使用 `fix:`、`feat:`、`docs:` 等前缀。

保留上游版权头、根目录 LICENSE 和许可证副本。复制或替换第三方代码/资源时说明实际来源与许可；不要将所有上游贡献改署名为自己。对本项目的贡献按适用的项目许可提供，第三方内容保留其各自许可，不能提交无权分发的代码或素材。

提交前核对暂存文件，避免把生产配置、测试凭据、截图、私人备份或生成的依赖目录加入 Git。不强推主分支，不为通过检查删除测试或擅自全量升级依赖。文档变更至少检查相对链接、命令与当前版本一致；代码变更运行相应测试。

是否合并和处理进度取决于维护者实际安排，本文件不承诺响应期限。

## English

This is the independently maintained **lanchenglin/memos-cloudflare** personal-notes derivative, based directly on **Allhuo/memos-cloudflare** and originally on **Memos**. It is not an official Memos distribution. See [source attribution and license notices](THIRD_PARTY_NOTICES.md).

Report branch-specific issues in [this repository](https://github.com/lanchenglin/memos-cloudflare/issues), including the actual commit/version, reproduction steps and sanitized diagnostics. Do not include credentials, cookies, private notes or production data. Consult [SECURITY.md](SECURITY.md) for security reporting.

Use the committed npm lockfiles with Node.js 24+ and Python 3.10+ (3.11+ recommended). From the repository root, run the setup, checks, tests and build commands above. Local browser smoke tests use an isolated runtime and do not establish production readiness.

Submit focused pull requests with tests and compatibility notes. Preserve upstream authorship and license notices, document any new third-party code or assets, and never commit private deployment configuration or backups. Third-party material retains its own license. Do not assume upstream maintainers support this derivative, and do not promise a review timetable on their behalf.
