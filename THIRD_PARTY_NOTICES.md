# 项目来源、版权与第三方许可声明

本文件补充根目录 [LICENSE](LICENSE)，不替代、不删减任何适用的许可文本或原版权声明。

## 1. 本项目的定位

**随手记 · Memos Cloudflare Personal**（`lanchenglin/memos-cloudflare`）是基于开源项目二次开发、面向个人图文记录的独立维护分支。本分支维护者为 [lanchenglin](https://github.com/lanchenglin)。维护者署名仅描述本分支的维护角色，不表示从零原创了全部代码，也不替代上游权利人署名。

本项目不是 Memos 官方发行版，不代表 Allhuo、Memos、Cloudflare 或其他上游贡献者作出承诺或背书。

## 2. 主要项目来源

### Memos：原始项目

- 项目：[usememos/memos](https://github.com/usememos/memos)。
- 本移植基线的文档标注前端对应 Memos **v0.29.1**；这不表示本仓库每个文件都与该 tag 完全相同。
- 对应 tag 解析到提交 `5f194da7d3f71a428b437898cdfd073c66a3df38`。
- 对应版本的原始许可证：[固定提交 LICENSE](https://github.com/usememos/memos/blob/5f194da7d3f71a428b437898cdfd073c66a3df38/LICENSE)。
- 原文版权行：`Copyright (c) 2025 Memos`。
- 许可：MIT；[本仓库原文副本](third_party/licenses/memos-v0.29.1-LICENSE.txt)。

Memos 的产品基础、原前端及相关上游代码应归入其原项目贡献，不将这些能力标为本分支原创。

### Allhuo/memos-cloudflare：直接二开基础

- 项目：[Allhuo/memos-cloudflare](https://github.com/Allhuo/memos-cloudflare)。
- 固定基线：`2206732987025e4d988e5a091deb825c0013c8fa`。
- 原始许可证：[固定基线 LICENSE](https://github.com/Allhuo/memos-cloudflare/blob/2206732987025e4d988e5a091deb825c0013c8fa/LICENSE)。
- 原文版权行：`Copyright (c) 2025-2026 Allhuo and contributors`。
- 许可：MIT；[本仓库原文副本](third_party/licenses/allhuo-memos-cloudflare-LICENSE.txt)。

本仓库基于该版本继续开发，保留其 Git 历史及根目录许可证。单 Worker、D1、R2 的 Cloudflare 移植基础来自上游，并非本分支首次实现。

### vividmuse/memos-cloudflare：继承的历史来源声明

直接上游 LICENSE 中列有 [vividmuse/memos-cloudflare](https://github.com/vividmuse/memos-cloudflare)，并标注 MIT。本仓库保留这一历史来源声明。

这里记录的是**直接上游许可证提供的来源信息**；本次没有独立核验其原始许可证，不虚构该项目的版权年份、贡献范围或与其他项目之间的完整继承顺序。链接将来不可用也不构成删除原声明的理由。

## 3. 为什么保留两份 Memos 年份记录？

直接上游基线 LICENSE 的历史来源段落写的是 `Copyright (c) 2021 memos`，而读取 Memos v0.29.1 对应固定提交的原始 LICENSE，版权行是 `Copyright (c) 2025 Memos`。

为避免擅自改写已经继承的许可原文，根目录 [LICENSE](LICENSE) 保持不变，同时另存 Memos 对应版本的完整许可证。两份文字的来源和核验值均列在[许可证索引](third_party/licenses/README.md)，本文件不尝试推断或裁定年份差异的历史原因。

## 4. 本分支的改进

0.3.0 个人图文版及后续文档工作主要围绕：个人图文记录入口、待整理等快捷筛选、附件文件名搜索、上传重试与限制、私有媒体访问、安全初始化、备份导出、测试及部署说明。具体差异以 [CHANGELOG.md](CHANGELOG.md) 和 Git 提交记录为准。

不要将整套上游笔记编辑器、全部标签/搜索能力或 Cloudflare 移植重新标记成本分支从零开发；也不要仅凭“AI 协助修改”就忽略原有代码的许可声明。

## 5. 分发时保留哪些文件？

本仓库沿用根目录 MIT 许可。按照其条款分发包含相关上游代码的软件副本或实质部分时，需要保留适用的版权及许可声明。建议源码包同时保留：

```text
LICENSE
THIRD_PARTY_NOTICES.md
third_party/licenses/README.md
third_party/licenses/memos-v0.29.1-LICENSE.txt
third_party/licenses/allhuo-memos-cloudflare-LICENSE.txt
```

README 的致谢不能替代完整许可文本。本文件中的推荐打包方式不是新增的限制性许可条款；具体权利、条件与免责约定以各许可证原文为准。MIT 条款参考：[Open Source Initiative 原文](https://opensource.org/license/mit)。

发布不包含源码的构建包时，也需要在随包文档、许可证目录或其他合适位置保留适用声明，不能因为打包或压缩而自动省略。

## 6. 第三方依赖与资源的范围

这里列出的是主要项目来源，**不是全部 npm 依赖、图标、图片、字体及其他资源的完整授权审计或软件物料清单**。依赖与资源适用各自的许可证；根目录的 MIT 不会把其他许可自动改成 MIT。

重新发布打包产物前，应按实际锁定版本检查各依赖、复制资源与已有版权头，保留要求随分发附带的声明。本次文档更新不宣称已完成这项全量审计。

## 7. 给贡献者与再次二开者

提交修改时保留已有作者署名、许可证和来源；新增或替换第三方代码/资源时，同步补充实际来源和适用许可。维护者可以说明自己的改动，但不能以本分支署名覆盖整套上游作者身份。

对外介绍可以使用：“基于 Allhuo/memos-cloudflare 二次开发，原项目为 Memos，由 lanchenglin 维护的个人图文增强版。” 可直接使用的介绍见 [docs/SHARING.md](docs/SHARING.md)。
